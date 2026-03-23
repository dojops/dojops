import type {
  LLMProvider,
  LLMToolResponse,
  AgentMessage,
  ToolDefinition,
  ToolCall,
  ToolResult,
} from "@dojops/core";
import { buildToolCallingSystemPrompt, parseToolCallsFromContent } from "@dojops/core";
import type { ToolExecutor } from "@dojops/executor";

export interface AgentLoopOptions {
  provider: LLMProvider;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  systemPrompt: string;
  /** Maximum number of LLM iterations (default: 50). */
  maxIterations?: number;
  /** Maximum total tokens before stopping (default: 200_000). */
  maxTotalTokens?: number;
  /** Reasoning effort level for extended thinking (Anthropic). */
  thinking?: "none" | "low" | "medium" | "high";
  /**
   * Called when the agent declares "done". Returns a list of validation issues.
   * If non-empty, the loop continues with the issues injected as feedback
   * instead of terminating. This gates output on validation passing.
   */
  validateBeforeDone?: () => Promise<string[]>;
  /** When set, enables progressive summarization to keep context focused. */
  summarizationProvider?: LLMProvider;
  onIteration?: (iteration: number, message: AgentMessage) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onThinking?: (text: string) => void;
}

export interface AgentLoopResult {
  success: boolean;
  summary: string;
  iterations: number;
  totalTokens: number;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  filesWritten: string[];
  filesModified: string[];
  /** Accumulated reasoning trace from extended thinking (when enabled). */
  reasoningTrace?: string;
}

/**
 * Try to extract summary from a parsed JSON object.
 * Handles {"tool_calls":[{"name":"done","arguments":{"summary":"..."}}]}
 * and {"summary":"..."} formats.
 */
function extractFromParsedJson(parsed: Record<string, unknown>): string | null {
  if (Array.isArray(parsed.tool_calls)) {
    const done = (
      parsed.tool_calls as Array<{ name?: string; arguments?: Record<string, unknown> }>
    ).find((tc) => tc.name === "done");
    if (done?.arguments?.summary && typeof done.arguments.summary === "string") {
      return done.arguments.summary;
    }
  }
  if (typeof parsed.summary === "string") return parsed.summary;
  return null;
}

/**
 * Regex fallback: extract "summary" value from malformed/truncated JSON.
 * Handles cases where JSON.parse fails due to truncation (e.g. missing closing brace).
 */
function extractSummaryByRegex(text: string): string | null {
  const match = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(text);
  if (!match) return null;
  return match[1]
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

/**
 * Extract a human-readable summary from LLM content.
 * Some models return the "done" tool call as JSON text instead of a native tool call,
 * sometimes truncated or embedded in surrounding text. This tries multiple strategies:
 * 1. JSON.parse for well-formed JSON
 * 2. Regex extraction for malformed/truncated JSON
 * 3. Strip JSON wrapper if present, return clean text
 */
function extractSummaryFromContent(content: string): string {
  if (!content) return "Task completed (no summary provided).";
  const trimmed = content.trim();

  // 1. Try JSON.parse (handles well-formed JSON anywhere in content)
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart !== -1) {
    const jsonCandidate = trimmed.slice(jsonStart);
    try {
      const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
      const extracted = extractFromParsedJson(parsed);
      if (extracted) return extracted;
    } catch {
      // JSON.parse failed — try regex fallback
    }

    // 2. Regex fallback for truncated/malformed JSON
    const regexResult = extractSummaryByRegex(jsonCandidate);
    if (regexResult) return regexResult;
  }

  // 3. If content is mostly JSON with a "done" reference but we couldn't extract, use default
  if (trimmed.includes('"done"') && trimmed.includes('"summary"')) {
    return "Task completed.";
  }

  // 4. Return content, stripping any leading/trailing non-text artifacts
  return trimmed;
}

/**
 * ReAct agent loop controller.
 * Iteratively: calls LLM with tools -> executes tool calls -> appends results -> repeats.
 * Terminates on: "done" tool, end_turn with no tool calls, max iterations, or token budget.
 */
export class AgentLoop {
  private readonly maxIterations: number;
  private readonly maxTotalTokens: number;
  private totalTokens = 0;
  /** Sliding window of recent tool call signatures for stale-loop detection. */
  private readonly recentCallSignatures: string[] = [];
  /** Number of consecutive repeated signatures before injecting reassessment. */
  private static readonly STALE_THRESHOLD = 3;

  constructor(private readonly opts: AgentLoopOptions) {
    this.maxIterations = opts.maxIterations ?? 50;
    this.maxTotalTokens = opts.maxTotalTokens ?? 200_000;
  }

  async run(userPrompt: string): Promise<AgentLoopResult> {
    const messages: AgentMessage[] = [{ role: "user", content: userPrompt }];
    const allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const thinkingParts: string[] = [];
    let summary = "";
    let success = false;
    let iterationCount = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      iterationCount++;
      const response = await this.generateWithTools(messages);

      // Capture reasoning trace from extended thinking
      if (response.thinking) {
        thinkingParts.push(response.thinking);
      }

      if (response.usage) {
        this.totalTokens += response.usage.totalTokens;
      }

      this.appendAssistantMessage(messages, response, iteration);

      if (response.content && this.opts.onThinking) {
        this.opts.onThinking(response.content);
      }

      // Check stop conditions
      const stopResult = this.checkStopConditions(response, allToolCalls, iteration);
      if (stopResult) {
        // Output validation gate: verify work before declaring success
        if (stopResult.success && this.opts.validateBeforeDone) {
          const issues = await this.opts.validateBeforeDone();
          if (issues.length > 0) {
            // Don't terminate — feed issues back so the agent can fix them
            messages.push({
              role: "user",
              content:
                "Before completing, validation found issues with the generated files:\n" +
                issues.map((i) => `- ${i}`).join("\n") +
                "\n\nFix these issues, then call 'done' again when resolved.",
            });
            continue;
          }
        }
        summary = stopResult.summary;
        success = stopResult.success;
        break;
      }

      // If LLM returned text-only without using tools, nudge it to use tools
      if (response.toolCalls.length === 0) {
        if (allToolCalls.length === 0) {
          messages.push({
            role: "user",
            content:
              "You must use the provided tools (write_file, edit_file, run_command, etc.) to complete this task. " +
              "Do not output file contents as text. Use write_file to create each file on disk.",
          });
        } else {
          // Agent made tool calls before but stopped outputting text without tools.
          // Nudge it to continue working — it may have described intent without acting.
          const hasFileWrites =
            this.opts.toolExecutor.getFilesWritten().length > 0 ||
            this.opts.toolExecutor.getFilesModified().length > 0;
          if (!hasFileWrites) {
            messages.push({
              role: "user",
              content:
                "You have not written any files to disk yet. Use write_file to create the requested files. " +
                "If you used run_skill, the generated content was returned as text — you must write it to disk with write_file. " +
                "Do not call done until all requested files exist on disk.",
            });
          } else {
            messages.push({
              role: "user",
              content:
                "Continue working. If all requested files have been created, call 'done' with a summary. " +
                "Otherwise, create the remaining files with write_file.",
            });
          }
        }
        continue;
      }

      // Execute tool calls
      await this.executeToolCalls(response.toolCalls, messages, allToolCalls);

      // Escalating stall detection: progressively stronger interventions
      const staleLevel = this.detectStaleLevel(response.toolCalls);
      if (staleLevel === "terminate") {
        const lastSig =
          this.recentCallSignatures[this.recentCallSignatures.length - 1] ?? "unknown";
        const toolName = lastSig.split(":")[0];
        summary = `Terminated: stuck in loop on ${toolName}`;
        success = false;
        break;
      } else if (staleLevel === "restrict") {
        const lastSig =
          this.recentCallSignatures[this.recentCallSignatures.length - 1] ?? "unknown";
        const toolName = lastSig.split(":")[0];
        messages.push({
          role: "user",
          content:
            `Do NOT call ${toolName} with these arguments again. ` +
            "Try a completely different approach or call 'done' if the task is finished.",
        });
      } else if (staleLevel === "nudge") {
        messages.push({
          role: "user",
          content:
            "You appear to be repeating the same action. Stop and reassess: " +
            "Is there a different approach? Are you stuck in a loop? " +
            "If the task is complete, call 'done'. If you need a different strategy, explain your reasoning.",
        });
      }

      // Check token budget
      if (this.totalTokens >= this.maxTotalTokens) {
        summary = `Stopped: token budget exhausted (${this.totalTokens}/${this.maxTotalTokens}).`;
        break;
      }

      await this.maybeSummarize(messages);
      this.compactMessages(messages);
    }

    if (iterationCount >= this.maxIterations && !success) {
      summary = `Stopped: reached maximum iterations (${this.maxIterations}).`;
    }

    return {
      success,
      summary,
      iterations: iterationCount,
      totalTokens: this.totalTokens,
      toolCalls: allToolCalls,
      filesWritten: this.opts.toolExecutor.getFilesWritten(),
      filesModified: this.opts.toolExecutor.getFilesModified(),
      reasoningTrace: thinkingParts.length > 0 ? thinkingParts.join("\n\n---\n\n") : undefined,
    };
  }

  /** Append assistant message to conversation history. */
  private appendAssistantMessage(
    messages: AgentMessage[],
    response: LLMToolResponse,
    iteration: number,
  ): void {
    const assistantMsg: AgentMessage = {
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    };
    messages.push(assistantMsg);
    this.opts.onIteration?.(iteration, assistantMsg);
  }

  /** Check if the loop should stop based on the LLM response. Returns null to continue. */
  private checkStopConditions(
    response: LLMToolResponse,
    allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
    iteration?: number,
  ): { summary: string; success: boolean } | null {
    if (response.stopReason === "end_turn" && response.toolCalls.length === 0) {
      // If no tools have been called yet, the LLM likely dumped text instead of using tools.
      // Return null to let the loop re-prompt with a nudge (handled in run()).
      if (allToolCalls.length === 0 && (iteration ?? 0) === 0) {
        return null;
      }
      return {
        summary: extractSummaryFromContent(response.content),
        success: true,
      };
    }

    if (response.stopReason === "max_tokens") {
      return { summary: "Stopped: LLM response hit max tokens limit.", success: false };
    }

    const doneCall = response.toolCalls.find((tc) => tc.name === "done");
    if (doneCall) {
      allToolCalls.push({ name: doneCall.name, arguments: doneCall.arguments });
      return {
        summary: (doneCall.arguments.summary as string) || "Task completed.",
        success: true,
      };
    }

    return null;
  }

  /** Execute all tool calls in a response and append results to messages. */
  private async executeToolCalls(
    toolCalls: ToolCall[],
    messages: AgentMessage[],
    allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  ): Promise<void> {
    for (const call of toolCalls) {
      this.opts.onToolCall?.(call);
      allToolCalls.push({ name: call.name, arguments: call.arguments });

      const result = await this.opts.toolExecutor.execute(call);
      this.opts.onToolResult?.(result);

      messages.push({
        role: "tool",
        callId: call.id,
        content: result.output,
        isError: result.isError,
      });
    }
  }

  /** Consecutive signature thresholds for stall escalation. */
  private static readonly RESTRICT_THRESHOLD = 5;
  private static readonly TERMINATE_THRESHOLD = 7;

  /**
   * Detect stall severity by counting consecutive identical tool call signatures.
   * Returns escalating levels: nudge (3), restrict (5), terminate (7).
   */
  private detectStaleLevel(toolCalls: ToolCall[]): "none" | "nudge" | "restrict" | "terminate" {
    for (const call of toolCalls) {
      const sig =
        call.name === "write_file" || call.name === "edit_file"
          ? `${call.name}:${call.arguments.path ?? ""}`
          : `${call.name}:${JSON.stringify(call.arguments)}`;
      this.recentCallSignatures.push(sig);
    }

    // Keep only the last 10 signatures
    while (this.recentCallSignatures.length > 10) {
      this.recentCallSignatures.shift();
    }

    if (this.recentCallSignatures.length < AgentLoop.STALE_THRESHOLD) return "none";

    const last = this.recentCallSignatures[this.recentCallSignatures.length - 1];
    let consecutiveCount = 0;
    for (let i = this.recentCallSignatures.length - 1; i >= 0; i--) {
      if (this.recentCallSignatures[i] === last) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount >= AgentLoop.TERMINATE_THRESHOLD) return "terminate";
    if (consecutiveCount >= AgentLoop.RESTRICT_THRESHOLD) return "restrict";
    if (consecutiveCount >= AgentLoop.STALE_THRESHOLD) return "nudge";
    return "none";
  }

  /**
   * Call LLM with tools — uses native generateWithTools if available,
   * falls back to prompt-based tool calling otherwise.
   */
  private async generateWithTools(messages: AgentMessage[]): Promise<LLMToolResponse> {
    if (this.opts.provider.generateWithTools) {
      return this.opts.provider.generateWithTools({
        system: this.opts.systemPrompt,
        messages,
        tools: this.opts.tools,
        thinking: this.opts.thinking,
      });
    }

    return this.fallbackGenerateWithTools(messages);
  }

  /** Prompt-based fallback for providers without native tool-calling. */
  private async fallbackGenerateWithTools(messages: AgentMessage[]): Promise<LLMToolResponse> {
    const augmentedSystem = buildToolCallingSystemPrompt(this.opts.systemPrompt, this.opts.tools);

    // Convert AgentMessages to ChatMessages for the standard generate() call
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

    const response = await this.opts.provider.generate({
      system: augmentedSystem,
      prompt: "", // Not used when messages is provided
      messages: chatMessages,
    });

    const result = parseToolCallsFromContent(response.content);
    result.usage = response.usage;
    return result;
  }

  /**
   * Estimate token count using word-based heuristic (same approach as MemoryManager).
   */
  private estimateTokens(messages: AgentMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (msg.content) totalChars += msg.content.length;
    }
    // ~4 chars per token on average
    return Math.ceil(totalChars / 4);
  }

  /**
   * Progressive summarization: when context exceeds 60% of budget, summarize
   * the oldest third of messages (preserving the initial user message).
   */
  private async maybeSummarize(messages: AgentMessage[]): Promise<void> {
    if (!this.opts.summarizationProvider) return;
    if (messages.length < 6) return; // too few messages to summarize

    const estimated = this.estimateTokens(messages);
    const threshold = this.maxTotalTokens * 0.6;
    if (estimated <= threshold) return;

    // Summarize the oldest third of messages (skip index 0 — initial user message)
    const summarizeCount = Math.max(2, Math.floor((messages.length - 1) / 3));
    const toSummarize = messages.slice(1, 1 + summarizeCount);

    const summaryText = toSummarize
      .map((m) => {
        const prefix = m.role === "tool" ? `[tool ${m.callId}]` : `[${m.role}]`;
        const content = (m.content ?? "").slice(0, 500);
        return `${prefix} ${content}`;
      })
      .join("\n");

    try {
      const result = await this.opts.summarizationProvider.generate({
        system:
          "Summarize these tool interactions concisely. Focus on: files read/written, commands run, what succeeded/failed, key decisions. Output only the summary.",
        prompt: summaryText,
      });

      // Replace summarized messages with a single system message
      messages.splice(1, summarizeCount, {
        role: "user",
        content: `[Context summary of earlier interactions]\n${result.content}`,
      });
    } catch {
      // Summarization failure is non-fatal — fall through to compactMessages
    }
  }

  /**
   * Compact old messages to prevent context overflow.
   * After 15 tool result messages, summarize older ones.
   */
  private compactMessages(messages: AgentMessage[]): void {
    const toolMessages = messages.filter((m) => m.role === "tool");
    if (toolMessages.length <= 15) return;

    // Find the oldest tool results beyond the last 10
    const keepCount = 10;
    let toolsSeen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tool") {
        toolsSeen++;
        if (toolsSeen > keepCount) {
          // Truncate old tool results to a single line
          const msg = messages[i] as {
            role: "tool";
            callId: string;
            content: string;
            isError?: boolean;
          };
          if (msg.content.length > 200) {
            msg.content = msg.content.slice(0, 200) + "\n[truncated — old tool result]";
          }
        }
      }
    }
  }
}
