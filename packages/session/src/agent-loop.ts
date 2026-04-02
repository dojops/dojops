import type {
  LLMProvider,
  LLMToolResponse,
  AgentMessage,
  ToolDefinition,
  ToolCall,
  ToolResult,
  HookEngine,
} from "@dojops/core";
import {
  buildToolCallingSystemPrompt,
  parseToolCallsFromContent,
  isContextOverflowError,
} from "@dojops/core";
import type { ToolExecutor, FileStateCache } from "@dojops/executor";
import { statSync } from "node:fs";
import { StreamingToolExecutor } from "./streaming-tool-executor";
import { ContextBudgetTracker } from "./context-budget";
import type { BudgetSnapshot } from "./context-budget";
import { TurnBudgetTracker } from "./turn-budget";
import type { TurnBudgetOptions, TurnBudgetStatus } from "./turn-budget";

export interface AgentLoopOptions {
  provider: LLMProvider;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  systemPrompt: string;
  /** Maximum number of LLM iterations (default: 50). */
  maxIterations?: number;
  /** Maximum total tokens before stopping (default: 200_000). */
  maxTotalTokens?: number;
  /** Provider name for context window detection (e.g. "openai", "anthropic"). */
  providerName?: string;
  /** Override the provider's default context window limit. */
  contextLimit?: number;
  /** Reasoning effort level for extended thinking (Anthropic). */
  thinking?: "none" | "low" | "medium" | "high";
  /**
   * Called when the agent declares "done". Returns a list of validation issues.
   * If non-empty, the loop continues with the issues injected as feedback
   * instead of terminating. This gates output on validation passing.
   */
  validateBeforeDone?: () => Promise<string[]>;
  /** When set, enables progressive and full summarization to keep context focused. */
  summarizationProvider?: LLMProvider;
  /** Pre-configured budget tracker. If omitted, one is created from the other options. */
  budgetTracker?: ContextBudgetTracker;
  /**
   * When running as a sub-agent, fraction of parent's remaining budget to use.
   * Typically set to 0.25 (25%) to prevent sub-agents from exhausting the parent budget.
   * Only applies when budgetTracker is a child created via createSubAgentBudget().
   */
  subAgentBudgetFraction?: number;
  /** Max times to continue after a max_tokens truncation (default: 3). */
  maxTokensContinuations?: number;
  /** Hook engine for lifecycle events (optional). */
  hookEngine?: HookEngine;
  /**
   * When true and there are multiple tool calls, leading read-only calls
   * execute concurrently (up to 5) via StreamingToolExecutor. Write calls
   * still run serially. When false or there is only one call, the existing
   * serial path is used. Default: true.
   */
  parallelTools?: boolean;
  /** In-memory file state cache. When provided, read_file results are cached and
   *  write_file/edit_file invalidate the affected paths. Reduces redundant disk reads. */
  fileCache?: FileStateCache;
  /** Per-turn token budget. Opt-in — when set, tracks tokens per turn and stops runaway loops. */
  turnBudget?: TurnBudgetOptions;
  /** Called when the turn budget emits a nudge or warning. */
  onBudgetWarning?: (status: TurnBudgetStatus) => void;
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
  /** Context budget state at the end of the run. */
  budgetSnapshot?: BudgetSnapshot;
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
  private readonly maxTokensContinuations: number;
  private readonly tracker: ContextBudgetTracker;
  private readonly turnBudget: TurnBudgetTracker | null;
  private readonly parallelTools: boolean;
  private readonly streamingExecutor: StreamingToolExecutor | null;
  /** Sliding window of recent tool call signatures for stale-loop detection. */
  private readonly recentCallSignatures: string[] = [];
  /** Number of consecutive repeated signatures before injecting reassessment. */
  private static readonly STALE_THRESHOLD = 3;
  /** How many max_tokens continuations have been used this run. */
  private continuationCount = 0;
  /** Whether a turn-budget nudge has already been injected this run. */
  private turnBudgetNudgeInjected = false;

  constructor(private readonly opts: AgentLoopOptions) {
    this.maxIterations = opts.maxIterations ?? 50;
    this.maxTokensContinuations = opts.maxTokensContinuations ?? 3;
    this.turnBudget = opts.turnBudget ? new TurnBudgetTracker(opts.turnBudget) : null;
    this.parallelTools = opts.parallelTools ?? true;
    this.streamingExecutor = this.parallelTools
      ? new StreamingToolExecutor({ toolExecutor: opts.toolExecutor })
      : null;
    this.tracker =
      opts.budgetTracker ??
      new ContextBudgetTracker({
        providerName: opts.providerName,
        contextLimit: opts.contextLimit,
        maxTotalTokens: opts.maxTotalTokens,
      });
  }

  async run(userPrompt: string): Promise<AgentLoopResult> {
    // Reset turn budget for each run (supports multiple user turns)
    this.turnBudget?.reset();
    this.turnBudgetNudgeInjected = false;

    const messages: AgentMessage[] = [{ role: "user", content: userPrompt }];
    const allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const thinkingParts: string[] = [];
    let summary = "";
    let success = false;
    let iterationCount = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      iterationCount++;

      // Emit AgentIteration hook (fire-and-forget, non-blocking)
      this.opts.hookEngine
        ?.emit("AgentIteration", {
          iteration,
          totalTokens: this.tracker.getSnapshot().totalConsumed,
        })
        .catch(() => {});

      // Generate with context overflow recovery
      let response: LLMToolResponse;
      try {
        response = await this.generateWithTools(messages);
      } catch (err) {
        if (isContextOverflowError(err)) {
          // Reactive compaction: force full compaction and retry once
          this.tracker.forceFullCompaction();
          await this.fullCompact(messages);
          this.tracker.recordCompaction(messages);
          try {
            response = await this.generateWithTools(messages);
          } catch {
            summary = "Stopped: context overflow persists after compaction.";
            break;
          }
        } else {
          throw err;
        }
      }

      // Capture reasoning trace from extended thinking
      if (response.thinking) {
        thinkingParts.push(response.thinking);
      }

      if (response.usage) {
        this.tracker.recordUsage(response.usage);

        // Record turn-level token usage when the tracker is enabled
        if (this.turnBudget) {
          const turnStatus = this.turnBudget.record(response.usage.totalTokens);
          if (turnStatus.nudgeMessage) {
            this.opts.onBudgetWarning?.(turnStatus);
          }
        }
      }

      this.appendAssistantMessage(messages, response, iteration);

      if (response.content && this.opts.onThinking) {
        this.opts.onThinking(response.content);
      }

      // H-23: Execute non-done tool calls before checking stop conditions.
      // When the LLM returns [write_file, done] in the same response, execute
      // the write_file first so work isn't silently dropped.
      const doneCall = response.toolCalls.find((tc) => tc.name === "done");
      const nonDoneCalls = response.toolCalls.filter((tc) => tc.name !== "done");
      if (doneCall && nonDoneCalls.length > 0) {
        await this.executeToolCalls(nonDoneCalls, messages, allToolCalls);
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

      // Max tokens recovery: inject continuation prompt to resume where the LLM left off
      if (response.stopReason === "max_tokens") {
        messages.push({
          role: "user",
          content:
            "Your response was cut off by the token limit. Resume directly from where you stopped. " +
            "Do not repeat what you already said. Continue working on the task.",
        });
        continue;
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

      // Turn-level token budget: nudge once, then force stop
      if (this.turnBudget?.shouldStop()) {
        if (this.turnBudgetNudgeInjected) {
          const turnStatus = this.turnBudget.getStatus();
          summary = turnStatus.exhausted
            ? `Stopped: turn token budget exhausted (${turnStatus.totalTokens}/${turnStatus.totalTokens + turnStatus.remaining} tokens).`
            : `Stopped: diminishing returns (${turnStatus.lowProgressCount} low-progress continuations).`;
          break;
        }
        // First time — inject a nudge and give the agent one more chance
        const turnStatus = this.turnBudget.getStatus();
        messages.push({
          role: "user",
          content:
            turnStatus.nudgeMessage ??
            "You are running low on turn budget. Wrap up your current task and call 'done'.",
        });
        this.turnBudgetNudgeInjected = true;
      }

      // Check hard token budget
      if (this.tracker.isBudgetExhausted()) {
        const snap = this.tracker.getSnapshot();
        summary = `Stopped: token budget exhausted (${snap.totalConsumed}/${snap.contextLimit}).`;
        break;
      }

      // Per-iteration budget check: if last iteration used 3x the average,
      // warn the agent to be more concise
      if (this.tracker.isIterationOverBudget()) {
        messages.push({
          role: "user",
          content:
            "Warning: the last iteration consumed significantly more tokens than average. " +
            "Be more concise in tool arguments and avoid reading large files unnecessarily. " +
            `Estimated iterations remaining: ${this.tracker.estimatedIterationsRemaining()}.`,
        });
      }

      // Three-tier context compaction
      await this.compactByTier(messages);
    }

    if (iterationCount >= this.maxIterations && !success) {
      summary = `Stopped: reached maximum iterations (${this.maxIterations}).`;
    }

    const budgetSnapshot = this.tracker.getSnapshot();
    return {
      success,
      summary,
      iterations: iterationCount,
      totalTokens: budgetSnapshot.totalConsumed,
      toolCalls: allToolCalls,
      filesWritten: this.opts.toolExecutor.getFilesWritten(),
      filesModified: this.opts.toolExecutor.getFilesModified(),
      reasoningTrace: thinkingParts.length > 0 ? thinkingParts.join("\n\n---\n\n") : undefined,
      budgetSnapshot,
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
      // Try to continue instead of stopping (up to maxTokensContinuations times)
      if (this.continuationCount < this.maxTokensContinuations) {
        this.continuationCount++;
        return null; // null = continue the loop; the run() method injects a continuation prompt
      }
      return {
        summary: "Stopped: LLM response hit max tokens limit after retries.",
        success: false,
      };
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
    // Use parallel execution when enabled and there are multiple calls
    if (this.streamingExecutor && toolCalls.length > 1) {
      await this.executeToolCallsParallel(toolCalls, messages, allToolCalls);
      return;
    }

    await this.executeToolCallsSerial(toolCalls, messages, allToolCalls);
  }

  /** Serial execution path — one tool at a time, in order. */
  private async executeToolCallsSerial(
    toolCalls: ToolCall[],
    messages: AgentMessage[],
    allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  ): Promise<void> {
    for (const call of toolCalls) {
      this.opts.onToolCall?.(call);
      allToolCalls.push({ name: call.name, arguments: call.arguments });

      // Emit PreExecute hook (non-blocking)
      this.opts.hookEngine
        ?.emit("PreExecute", { tool: call.name, arguments: call.arguments })
        .catch(() => {});

      // Check file cache for read_file calls without offset/limit
      const cached = this.getCachedReadResult(call);
      const result = cached ?? (await this.opts.toolExecutor.execute(call));

      // Store successful full-file reads in cache; invalidate on writes
      this.updateFileCache(call, result);

      this.opts.onToolResult?.(result);

      // Emit PostExecute hook (non-blocking)
      this.opts.hookEngine
        ?.emit("PostExecute", {
          tool: call.name,
          success: !result.isError,
          outputLength: result.output.length,
        })
        .catch(() => {});

      messages.push({
        role: "tool",
        callId: call.id,
        content: result.output,
        isError: result.isError,
      });
    }
  }

  /**
   * Parallel execution path — leading read-only tools run concurrently,
   * write tools run serially. Results appended in original call order.
   */
  private async executeToolCallsParallel(
    toolCalls: ToolCall[],
    messages: AgentMessage[],
    allToolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  ): Promise<void> {
    // Record tool calls and fire onToolCall/PreExecute before batch starts
    for (const call of toolCalls) {
      this.opts.onToolCall?.(call);
      allToolCalls.push({ name: call.name, arguments: call.arguments });
      this.opts.hookEngine
        ?.emit("PreExecute", { tool: call.name, arguments: call.arguments })
        .catch(() => {});
    }

    const batch = await this.streamingExecutor!.executeBatch(toolCalls);

    // Append results in original order and fire PostExecute hooks
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const result = batch.results[i];

      // Store successful reads in cache; invalidate on writes
      this.updateFileCache(call, result);

      this.opts.onToolResult?.(result);

      this.opts.hookEngine
        ?.emit("PostExecute", {
          tool: call.name,
          success: !result.isError,
          outputLength: result.output.length,
        })
        .catch(() => {});

      messages.push({
        role: "tool",
        callId: call.id,
        content: result.output,
        isError: result.isError,
      });
    }
  }

  // ── File cache helpers ──────────────────────────────────────────

  /** Check file cache for a read_file call with no offset/limit. Returns a cached ToolResult or null. */
  private getCachedReadResult(call: ToolCall): ToolResult | null {
    if (!this.opts.fileCache) return null;
    if (call.name !== "read_file") return null;
    // Only cache full-file reads (no offset/limit) to avoid stale partial results
    if (call.arguments.offset != null || call.arguments.limit != null) return null;

    const filePath = call.arguments.path as string;
    const cached = this.opts.fileCache.get(filePath);
    if (!cached) return null;

    return { callId: call.id, output: cached.content };
  }

  /** After tool execution, update the file cache: store reads, invalidate writes. */
  private updateFileCache(call: ToolCall, result: ToolResult): void {
    if (!this.opts.fileCache) return;

    const filePath = call.arguments.path as string | undefined;
    if (!filePath) return;

    if (call.name === "write_file" || call.name === "edit_file") {
      this.opts.fileCache.invalidate(filePath);
      return;
    }

    if (call.name === "read_file" && !result.isError) {
      // Only cache full-file reads
      if (call.arguments.offset != null || call.arguments.limit != null) return;
      try {
        const stat = statSync(filePath);
        this.opts.fileCache.set(filePath, result.output, stat.mtimeMs);
      } catch {
        // Path unresolvable (relative, missing, etc.) — skip caching
      }
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
   * Three-tier context compaction driven by ContextBudgetTracker.
   * - micro: truncate old tool results (no LLM call)
   * - progressive: summarize oldest third via LLM
   * - full: compress entire conversation into a single summary
   */
  private async compactByTier(messages: AgentMessage[]): Promise<void> {
    const tier = this.tracker.evaluate(messages);
    if (tier === "none") return;

    if (tier === "micro") {
      this.microCompact(messages);
      this.tracker.recordCompaction(messages);
      return;
    }

    if (tier === "progressive") {
      this.microCompact(messages);
      await this.progressiveSummarize(messages);
      this.tracker.recordCompaction(messages);
      return;
    }

    // tier === "full"
    this.microCompact(messages);
    await this.fullCompact(messages);
    this.tracker.recordCompaction(messages);
  }

  /**
   * Micro-compaction: truncate old tool results to 200 chars.
   * Keeps the most recent 10 tool results intact.
   */
  private microCompact(messages: AgentMessage[]): void {
    const keepCount = 10;
    let toolsSeen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "tool") {
        toolsSeen++;
        if (toolsSeen > keepCount) {
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

  /**
   * Progressive summarization: summarize the oldest third of messages
   * (preserving the initial user message) using the summarization provider.
   */
  private async progressiveSummarize(messages: AgentMessage[]): Promise<void> {
    if (!this.opts.summarizationProvider) return;
    if (messages.length < 6) return;

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

      messages.splice(1, summarizeCount, {
        role: "user",
        content: `[Context summary of earlier interactions]\n${result.content}`,
      });
    } catch {
      // Summarization failure is non-fatal
    }
  }

  /**
   * Full compaction: compress the entire conversation (except the initial user
   * message and the most recent 4 messages) into a single context summary.
   * Used as a last resort when approaching the provider's context limit.
   */
  private async fullCompact(messages: AgentMessage[]): Promise<void> {
    if (!this.opts.summarizationProvider) return;
    const keepRecent = 4;
    if (messages.length <= keepRecent + 2) return; // nothing to compact

    const toSummarize = messages.slice(1, messages.length - keepRecent);
    const summaryText = toSummarize
      .map((m) => {
        const prefix = m.role === "tool" ? `[tool ${m.callId}]` : `[${m.role}]`;
        const content = (m.content ?? "").slice(0, 300);
        return `${prefix} ${content}`;
      })
      .join("\n");

    try {
      const result = await this.opts.summarizationProvider.generate({
        system:
          "Compress this entire conversation into a concise summary. Include: the original task, all files created/modified, commands run and their outcomes, key decisions made, current state of progress. Output only the summary.",
        prompt: summaryText,
      });

      messages.splice(1, toSummarize.length, {
        role: "user",
        content: `[Full context summary — earlier messages compacted]\n${result.content}`,
      });
    } catch {
      // Full compaction failure is non-fatal — micro-compact already ran
    }
  }
}
