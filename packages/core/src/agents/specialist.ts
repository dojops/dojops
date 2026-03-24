import { ChatMessage, LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "../llm/provider";
import { sanitizeUserInput } from "../llm/sanitizer";
import { validateRequestSize } from "../llm/input-validator";
import { ToolDependency } from "./tool-deps";
import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  AgentMessage,
  LLMToolResponse,
} from "../llm/tool-types";
import {
  buildToolCallingSystemPrompt,
  parseToolCallsFromContent,
} from "../llm/prompt-tool-calling";

/** Maximum content length for a single message (128KB). */
const MAX_MESSAGE_LENGTH = 128 * 1024;
/** Default timeout for LLM calls in milliseconds. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Default max iterations for agentic mode. */
const DEFAULT_AGENTIC_MAX_ITERATIONS = 10;
/** Default max tokens for agentic mode. */
const DEFAULT_AGENTIC_MAX_TOKENS = 50_000;
/** Consecutive identical tool calls before termination. */
const AGENTIC_STALE_THRESHOLD = 3;

export interface SpecialistConfig {
  name: string;
  domain: string;
  description?: string;
  systemPrompt: string;
  keywords: string[];
  /** High-signal keywords that get a confidence boost when matched. */
  primaryKeywords?: string[];
  toolDependencies?: ToolDependency[];
}

/**
 * Minimal tool executor interface for agentic mode.
 * Satisfied by ToolExecutor from @dojops/executor without creating a dependency.
 */
export interface AgenticToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
  getFilesWritten(): string[];
  getFilesModified(): string[];
}

/** Options for running a specialist in agentic mode with tool access. */
export interface AgenticOptions {
  toolExecutor: AgenticToolExecutor;
  tools: ToolDefinition[];
  /** Maximum ReAct loop iterations (default: 10). */
  maxIterations?: number;
  /** Maximum total tokens before stopping (default: 50,000). */
  maxTotalTokens?: number;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onIteration?: (iteration: number, content: string) => void;
}

/** Result from an agentic specialist run. */
export interface AgenticResult {
  success: boolean;
  content: string;
  iterations: number;
  totalTokens: number;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  filesWritten: string[];
  filesModified: string[];
}

/** Check whether an error is transient (network/5xx) and worth retrying. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network errors
  if (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  )
    return true;
  // HTTP 5xx / 429
  if (/\b(5\d{2}|429)\b/.test(msg)) return true;
  return false;
}

export class SpecialistAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: SpecialistConfig,
    private readonly docAugmenter?: {
      augmentPrompt(s: string, kw: string[], q: string): Promise<string>;
    },
  ) {}

  get name(): string {
    return this.config.name;
  }

  get domain(): string {
    return this.config.domain;
  }

  get description(): string | undefined {
    return this.config.description;
  }

  get keywords(): string[] {
    return this.config.keywords;
  }

  get primaryKeywords(): string[] {
    return this.config.primaryKeywords ?? [];
  }

  get systemPrompt(): string {
    return this.config.systemPrompt;
  }

  get toolDependencies(): ToolDependency[] {
    return this.config.toolDependencies ?? [];
  }

  async run(
    request: Omit<LLMRequest, "system">,
    opts?: { timeoutMs?: number },
  ): Promise<LLMResponse> {
    let systemPrompt = this.config.systemPrompt;
    if (this.docAugmenter) {
      try {
        const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
        systemPrompt = await this.docAugmenter.augmentPrompt(
          systemPrompt,
          keywords,
          request.prompt,
        );
      } catch {
        // Graceful degradation: proceed without docs
      }
    }

    const fullRequest = {
      ...request,
      prompt: sanitizeUserInput(request.prompt),
      system: systemPrompt,
    };

    const validation = validateRequestSize(fullRequest);
    if (validation.warning) {
      console.warn(`[${this.config.name}] ${validation.warning}`);
    }

    return this.executeWithRetry(() => this.provider.generate(fullRequest), opts?.timeoutMs);
  }

  async runWithHistory(
    messages: ChatMessage[],
    opts?: Omit<LLMRequest, "system" | "prompt" | "messages"> & { timeoutMs?: number },
  ): Promise<LLMResponse> {
    const sanitizedMessages = messages
      .filter((m) => m.content.length <= MAX_MESSAGE_LENGTH)
      .map((m) => ({
        ...m,
        content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
      }));

    // Providers strip system messages from the messages array — merge them
    // into the system prompt so project context, chat-mode instructions, and
    // conversation summaries actually reach the LLM.
    const contextSystemMsgs = sanitizedMessages.filter((m) => m.role === "system");
    const nonSystemMessages = sanitizedMessages.filter((m) => m.role !== "system");

    let systemPrompt = this.config.systemPrompt;
    if (contextSystemMsgs.length > 0) {
      const contextBlock = contextSystemMsgs.map((m) => m.content).join("\n\n");
      systemPrompt = `${systemPrompt}\n\n${contextBlock}`;
    }

    if (this.docAugmenter && nonSystemMessages.length > 0) {
      try {
        const lastUserMsg = [...nonSystemMessages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
          systemPrompt = await this.docAugmenter.augmentPrompt(
            systemPrompt,
            keywords,
            lastUserMsg.content,
          );
        }
      } catch {
        // Graceful degradation: proceed without docs
      }
    }

    const { timeoutMs, ...llmOpts } = opts ?? {};
    return this.executeWithRetry(
      () =>
        this.provider.generate({
          ...llmOpts,
          prompt: "",
          messages: nonSystemMessages,
          system: systemPrompt,
        }),
      timeoutMs,
    );
  }

  /** Whether the underlying provider supports streaming. */
  get supportsStreaming(): boolean {
    return typeof this.provider.generateStream === "function";
  }

  /**
   * Stream a response with full chat history. Falls back to non-streaming if
   * the provider does not implement generateStream.
   */
  async streamWithHistory(
    messages: ChatMessage[],
    onChunk: StreamCallback,
    opts?: Omit<LLMRequest, "system" | "prompt" | "messages"> & { timeoutMs?: number },
  ): Promise<LLMResponse> {
    if (!this.provider.generateStream) {
      // Fallback: run non-streaming, emit full content as one chunk
      const result = await this.runWithHistory(messages, opts);
      onChunk(result.content);
      return result;
    }

    const sanitizedMessages = messages
      .filter((m) => m.content.length <= MAX_MESSAGE_LENGTH)
      .map((m) => ({
        ...m,
        content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
      }));

    // Merge system messages into the system prompt (providers strip them from messages)
    const contextSystemMsgs = sanitizedMessages.filter((m) => m.role === "system");
    const nonSystemMessages = sanitizedMessages.filter((m) => m.role !== "system");

    let systemPrompt = this.config.systemPrompt;
    if (contextSystemMsgs.length > 0) {
      const contextBlock = contextSystemMsgs.map((m) => m.content).join("\n\n");
      systemPrompt = `${systemPrompt}\n\n${contextBlock}`;
    }

    if (this.docAugmenter && nonSystemMessages.length > 0) {
      try {
        const lastUserMsg = [...nonSystemMessages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
          systemPrompt = await this.docAugmenter.augmentPrompt(
            systemPrompt,
            keywords,
            lastUserMsg.content,
          );
        }
      } catch {
        // Graceful degradation: proceed without docs
      }
    }

    const { timeoutMs, ...llmOpts } = opts ?? {};
    const request: LLMRequest = {
      ...llmOpts,
      prompt: "",
      messages: nonSystemMessages,
      system: systemPrompt,
    };

    return this.executeWithRetry(() => this.provider.generateStream!(request, onChunk), timeoutMs);
  }

  /**
   * Run the specialist in agentic mode with tool access and a ReAct loop.
   * Unlike run() which makes a single LLM call, this iterates:
   * call LLM with tools -> execute tool calls -> feed results -> repeat.
   *
   * When no tools/toolExecutor are provided, falls back to a single run() call
   * and wraps the result as an AgenticResult for uniform handling.
   */
  async runAgentic(prompt: string, opts: AgenticOptions): Promise<AgenticResult> {
    const maxIterations = opts.maxIterations ?? DEFAULT_AGENTIC_MAX_ITERATIONS;
    const maxTokens = opts.maxTotalTokens ?? DEFAULT_AGENTIC_MAX_TOKENS;
    let totalTokens = 0;
    const allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const recentSignatures: string[] = [];

    let systemPrompt = this.config.systemPrompt;
    if (this.docAugmenter) {
      try {
        const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
        systemPrompt = await this.docAugmenter.augmentPrompt(systemPrompt, keywords, prompt);
      } catch {
        // Graceful degradation
      }
    }

    const messages: AgentMessage[] = [{ role: "user", content: sanitizeUserInput(prompt) }];
    let summary = "";
    let success = false;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const response = await this.generateAgenticResponse(systemPrompt, messages, opts.tools);

      if (response.usage) {
        totalTokens += response.usage.totalTokens;
      }

      // Append assistant message
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });
      opts.onIteration?.(iteration, response.content);

      // Check for "done" tool call
      const doneCall = response.toolCalls.find((tc) => tc.name === "done");
      if (doneCall) {
        allToolCalls.push({ name: doneCall.name, arguments: doneCall.arguments });
        summary = (doneCall.arguments.summary as string) || "Task completed.";
        success = true;
        break;
      }

      // End turn with no tool calls = finished
      if (response.stopReason === "end_turn" && response.toolCalls.length === 0) {
        if (allToolCalls.length > 0 || iteration > 0) {
          summary = response.content || "Task completed.";
          success = true;
          break;
        }
        // First iteration with no tools used — nudge the agent
        messages.push({
          role: "user",
          content: "Use the provided tools to complete this task. Do not output results as text.",
        });
        continue;
      }

      if (response.stopReason === "max_tokens") {
        summary = "Stopped: LLM response hit max tokens limit.";
        break;
      }

      // Execute tool calls (skip "done" which was already handled above)
      const actionCalls = response.toolCalls.filter((tc) => tc.name !== "done");
      for (const call of actionCalls) {
        opts.onToolCall?.(call);
        allToolCalls.push({ name: call.name, arguments: call.arguments });
        const result = await opts.toolExecutor.execute(call);
        opts.onToolResult?.(result);
        messages.push({
          role: "tool",
          callId: call.id,
          content: result.output,
          isError: result.isError,
        });
      }

      // Stall detection: terminate if the same call repeats consecutively
      for (const call of actionCalls) {
        const sig = `${call.name}:${JSON.stringify(call.arguments)}`;
        recentSignatures.push(sig);
      }
      while (recentSignatures.length > 10) recentSignatures.shift();
      if (this.isStale(recentSignatures)) {
        summary = `Terminated: stuck in loop on ${actionCalls[0]?.name ?? "unknown"}.`;
        break;
      }

      // Token budget check
      if (totalTokens >= maxTokens) {
        summary = `Stopped: token budget exhausted (${totalTokens}/${maxTokens}).`;
        break;
      }

      // Compact old tool results to prevent context overflow
      this.compactAgenticMessages(messages);
    }

    if (!summary) {
      summary = `Stopped: reached maximum iterations (${maxIterations}).`;
    }

    return {
      success,
      content: summary,
      iterations: allToolCalls.length,
      totalTokens,
      toolCalls: allToolCalls,
      filesWritten: opts.toolExecutor.getFilesWritten(),
      filesModified: opts.toolExecutor.getFilesModified(),
    };
  }

  /** Call LLM with tools — native if available, prompt-based fallback otherwise. */
  private async generateAgenticResponse(
    systemPrompt: string,
    messages: AgentMessage[],
    tools: ToolDefinition[],
  ): Promise<LLMToolResponse> {
    if (this.provider.generateWithTools) {
      return this.provider.generateWithTools({ system: systemPrompt, messages, tools });
    }
    // Prompt-based fallback for providers without native tool calling
    const augmented = buildToolCallingSystemPrompt(systemPrompt, tools);
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return { role: "user" as const, content: `Tool result (${m.callId}): ${m.content}` };
        }
        if (m.role === "assistant" && m.toolCalls?.length) {
          const callsJson = JSON.stringify({
            tool_calls: m.toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments })),
          });
          return { role: "assistant" as const, content: callsJson };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      });
    const response = await this.provider.generate({
      system: augmented,
      prompt: "",
      messages: chatMessages,
    });
    const result = parseToolCallsFromContent(response.content);
    result.usage = response.usage;
    return result;
  }

  /** Check if the last N signatures are all identical (stall detection). */
  private isStale(signatures: string[]): boolean {
    if (signatures.length < AGENTIC_STALE_THRESHOLD) return false;
    const last = signatures[signatures.length - 1];
    let count = 0;
    for (let i = signatures.length - 1; i >= 0; i--) {
      if (signatures[i] === last) count++;
      else break;
    }
    return count >= AGENTIC_STALE_THRESHOLD;
  }

  /** Truncate old tool results to keep context manageable. */
  private compactAgenticMessages(messages: AgentMessage[]): void {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    if (toolMsgs.length <= 8) return;
    let seen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tool") {
        seen++;
        if (seen > 6) {
          const msg = messages[i] as {
            role: "tool";
            callId: string;
            content: string;
            isError?: boolean;
          };
          if (msg.content.length > 150) {
            msg.content = msg.content.slice(0, 150) + "\n[truncated]";
          }
        }
      }
    }
  }

  /** Execute an LLM call with timeout and a single retry on transient errors. */
  private async executeWithRetry(
    fn: () => Promise<LLMResponse>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<LLMResponse> {
    const callWithTimeout = (): Promise<LLMResponse> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Agent ${this.config.name} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      return Promise.race([fn(), timeoutPromise]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    };

    try {
      return await callWithTimeout();
    } catch (err) {
      if (isTransientError(err)) {
        // Single retry after brief delay
        await new Promise((r) => setTimeout(r, 1000));
        return callWithTimeout();
      }
      throw err;
    }
  }
}
