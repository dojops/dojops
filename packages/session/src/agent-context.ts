import type { LLMProvider, ToolDefinition, AgentMessage } from "@dojops/core";
import type { ToolExecutor } from "@dojops/executor";
import { ContextBudgetTracker } from "./context-budget";
import type { BudgetSnapshot } from "./context-budget";

/**
 * Configuration for creating an isolated agent context.
 */
export interface AgentContextOptions {
  provider: LLMProvider;
  providerName?: string;
  toolExecutor: ToolExecutor;
  tools: ToolDefinition[];
  systemPrompt: string;
  /** Token budget for this context (default: 25% of parent's remaining, or 50_000). */
  maxTotalTokens?: number;
  /** Context window limit override. */
  contextLimit?: number;
  /** Abort signal for this context. If omitted, a new AbortController is created. */
  abortSignal?: AbortSignal;
}

/**
 * Isolated execution context for a sub-agent.
 *
 * Each sub-agent gets its own:
 * - AbortController (can be killed independently without affecting the parent)
 * - ContextBudgetTracker (separate token budget, separate compaction state)
 * - Message history (starts empty, not shared with parent)
 * - Tool set (can be a subset of the parent's tools)
 *
 * The provider and toolExecutor are shared references (read-only usage),
 * but the budget and abort signal provide isolation guarantees.
 */
export class AgentContext {
  readonly provider: LLMProvider;
  readonly providerName: string;
  readonly toolExecutor: ToolExecutor;
  readonly tools: ToolDefinition[];
  readonly systemPrompt: string;
  readonly tracker: ContextBudgetTracker;
  readonly abortController: AbortController;
  readonly messages: AgentMessage[];

  private readonly createdAt = Date.now();

  constructor(opts: AgentContextOptions) {
    this.provider = opts.provider;
    this.providerName = opts.providerName ?? opts.provider.name;
    this.toolExecutor = opts.toolExecutor;
    this.tools = [...opts.tools]; // defensive copy
    this.systemPrompt = opts.systemPrompt;
    this.messages = [];

    this.tracker = new ContextBudgetTracker({
      providerName: opts.providerName,
      contextLimit: opts.contextLimit,
      maxTotalTokens: opts.maxTotalTokens ?? 50_000,
    });

    // Own abort controller; optionally chain to a parent signal
    this.abortController = new AbortController();
    if (opts.abortSignal) {
      opts.abortSignal.addEventListener("abort", () => {
        this.abortController.abort(opts.abortSignal!.reason);
      });
    }
  }

  /** Check if this context has been aborted. */
  get isAborted(): boolean {
    return this.abortController.signal.aborted;
  }

  /** Abort this sub-agent. Does not affect other contexts. */
  abort(reason?: string): void {
    this.abortController.abort(reason ?? "Sub-agent aborted");
  }

  /** Get the budget snapshot for reporting. */
  getBudgetSnapshot(): BudgetSnapshot {
    return this.tracker.getSnapshot();
  }

  /** How long this context has been alive (milliseconds). */
  getAge(): number {
    return Date.now() - this.createdAt;
  }

  /**
   * Create a child context from this one.
   * The child gets:
   * - Same provider (shared)
   * - Same tool executor (shared)
   * - A subset of tools (or all if not specified)
   * - Its own budget (fraction of this context's remaining budget)
   * - Its own abort signal (chained to this context's signal)
   * - Empty message history
   */
  createChild(opts?: {
    tools?: ToolDefinition[];
    systemPrompt?: string;
    budgetFraction?: number;
    maxTotalTokens?: number;
  }): AgentContext {
    const fraction = opts?.budgetFraction ?? 0.25;
    const childBudget =
      opts?.maxTotalTokens ??
      Math.max(5_000, Math.floor(this.tracker.budgetRemaining() * fraction));

    return new AgentContext({
      provider: this.provider,
      providerName: this.providerName,
      toolExecutor: this.toolExecutor,
      tools: opts?.tools ?? this.tools,
      systemPrompt: opts?.systemPrompt ?? this.systemPrompt,
      maxTotalTokens: childBudget,
      contextLimit: this.tracker.getSnapshot().contextLimit,
      abortSignal: this.abortController.signal,
    });
  }

  /**
   * Summarize this context's results for returning to the parent.
   * Takes the messages and produces a short summary, avoiding
   * leaking the full message history back to the parent context.
   */
  summarizeResults(): string {
    const assistantMsgs = this.messages.filter(
      (m): m is AgentMessage & { role: "assistant" } => m.role === "assistant",
    );
    if (assistantMsgs.length === 0) return "(no results)";

    // Return the last assistant message content (most relevant)
    const last = assistantMsgs[assistantMsgs.length - 1];
    if (last.content.length <= 2000) return last.content;
    return last.content.slice(0, 2000) + "\n[result truncated]";
  }
}
