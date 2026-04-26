import type { LLMUsage, AgentMessage } from "@dojops/core";

/**
 * Known context window sizes per provider.
 * Used as the budget ceiling for compaction decisions.
 */
export const PROVIDER_CONTEXT_LIMITS: Record<string, number> = {
  openai: 128_000,
  anthropic: 200_000,
  ollama: 32_000,
  deepseek: 64_000,
  mistral: 128_000,
  gemini: 1_000_000,
  "github-copilot": 128_000,
};

/** Default context window if provider is unknown. */
const DEFAULT_CONTEXT_LIMIT = 128_000;

/** Compaction tier — returned by the tracker so the caller knows what action to take. */
export type CompactionTier = "none" | "micro" | "progressive" | "full";

/** Snapshot of the tracker's state for external consumption. */
export interface BudgetSnapshot {
  /** Tokens consumed so far (from actual provider usage data). */
  totalConsumed: number;
  /** Estimated tokens in the current context window. */
  estimatedContextTokens: number;
  /** Maximum context window for the configured provider. */
  contextLimit: number;
  /** Fraction of context used (0-1). */
  utilization: number;
  /** Which compaction tier would be triggered right now. */
  recommendedAction: CompactionTier;
  /** Number of compaction events that have occurred. */
  compactionCount: number;
}

/** Budget alert — emitted when spending crosses a threshold. */
export interface BudgetAlert {
  level: "warning" | "critical";
  message: string;
  /** Fraction of total budget consumed (0-1). */
  budgetUtilization: number;
  tokensRemaining: number;
}

export interface ContextBudgetTrackerOptions {
  /** Provider name (e.g. "openai", "anthropic"). Used to look up context limit. */
  providerName?: string;
  /** Override the provider's default context limit. */
  contextLimit?: number;
  /** Hard budget on total tokens consumed across all iterations (default: 200_000). */
  maxTotalTokens?: number;
  /**
   * Utilization threshold for micro-compaction (truncate old tool results).
   * Default: 0.50 (50%).
   */
  microThreshold?: number;
  /**
   * Utilization threshold for progressive summarization.
   * Default: 0.70 (70%).
   */
  progressiveThreshold?: number;
  /**
   * Utilization threshold for full compaction (summarize everything).
   * Default: 0.85 (85%).
   */
  fullThreshold?: number;
  /** Fraction of total budget that triggers a warning alert (default: 0.80). */
  warningThreshold?: number;
  /** Fraction of total budget that triggers a critical alert (default: 0.95). */
  criticalThreshold?: number;
  /** Called when spending crosses a threshold. */
  onBudgetAlert?: (alert: BudgetAlert) => void;
}

/**
 * Tracks token usage per LLM call and estimates current context window usage.
 * Decides which compaction tier to recommend based on configurable thresholds.
 *
 * Three-tier compaction:
 * 1. Micro: truncate old tool results to short summaries (cheap, no LLM call)
 * 2. Progressive: summarize the oldest third of messages using a fast model
 * 3. Full: compress the entire conversation into a single context summary
 *
 * Also handles reactive compaction: when a provider returns a context overflow
 * error, the caller invokes `forceCompaction()` to jump straight to full tier.
 */
export class ContextBudgetTracker {
  private readonly contextLimit: number;
  private readonly maxTotalTokens: number;
  private readonly microThreshold: number;
  private readonly progressiveThreshold: number;
  private readonly fullThreshold: number;
  private readonly warningThreshold: number;
  private readonly criticalThreshold: number;
  private readonly onBudgetAlert?: (alert: BudgetAlert) => void;

  /** Cumulative token usage from actual provider responses. */
  private totalConsumed = 0;
  /** Per-iteration usage for tracking spending rate. */
  private iterationUsages: number[] = [];
  /** How many compaction events have occurred. */
  private compactionCount = 0;
  /** Last known context token estimate (set after each evaluate() call). */
  private lastEstimate = 0;
  /** Track which alert levels have already been emitted to avoid duplicates. */
  private emittedAlerts = new Set<"warning" | "critical">();

  constructor(opts: ContextBudgetTrackerOptions = {}) {
    const providerLimit = opts.providerName
      ? PROVIDER_CONTEXT_LIMITS[opts.providerName]
      : undefined;
    this.contextLimit = opts.contextLimit ?? providerLimit ?? DEFAULT_CONTEXT_LIMIT;
    this.maxTotalTokens = opts.maxTotalTokens ?? 200_000;
    this.microThreshold = opts.microThreshold ?? 0.5;
    this.progressiveThreshold = opts.progressiveThreshold ?? 0.7;
    this.fullThreshold = opts.fullThreshold ?? 0.85;
    this.warningThreshold = opts.warningThreshold ?? 0.8;
    this.criticalThreshold = opts.criticalThreshold ?? 0.95;
    this.onBudgetAlert = opts.onBudgetAlert;
  }

  /** Record actual token usage from a provider response. */
  recordUsage(usage: LLMUsage): void {
    this.totalConsumed += usage.totalTokens;
    this.iterationUsages.push(usage.totalTokens);
    this.checkBudgetAlerts();
  }

  /** Check whether the hard token budget has been exhausted. */
  isBudgetExhausted(): boolean {
    return this.totalConsumed >= this.maxTotalTokens;
  }

  /** Return how many tokens remain in the hard budget. */
  budgetRemaining(): number {
    return Math.max(0, this.maxTotalTokens - this.totalConsumed);
  }

  /**
   * Evaluate the current messages and return the recommended compaction tier.
   * Call this after each iteration to decide what (if any) compaction to run.
   */
  evaluate(messages: AgentMessage[]): CompactionTier {
    const estimate = this.estimateContextTokens(messages);
    this.lastEstimate = estimate;
    const utilization = estimate / this.contextLimit;

    if (utilization >= this.fullThreshold) return "full";
    if (utilization >= this.progressiveThreshold) return "progressive";
    if (utilization >= this.microThreshold) return "micro";
    return "none";
  }

  /**
   * Called after a compaction event to record it.
   * Re-evaluates context size from the post-compaction messages.
   */
  recordCompaction(postMessages: AgentMessage[]): void {
    this.compactionCount++;
    this.lastEstimate = this.estimateContextTokens(postMessages);
  }

  /**
   * Force the tracker into a state that demands full compaction.
   * Used for reactive compaction when a provider returns a context overflow error
   * (e.g. HTTP 413, "prompt is too long", "context_length_exceeded").
   */
  forceFullCompaction(): CompactionTier {
    this.compactionCount++;
    return "full";
  }

  /** Get a snapshot of the tracker state. */
  getSnapshot(): BudgetSnapshot {
    const utilization = this.lastEstimate / this.contextLimit;
    return {
      totalConsumed: this.totalConsumed,
      estimatedContextTokens: this.lastEstimate,
      contextLimit: this.contextLimit,
      utilization: Math.min(1, utilization),
      recommendedAction: this.tierFromUtilization(utilization),
      compactionCount: this.compactionCount,
    };
  }

  /** Average tokens per iteration (for spending rate analysis). */
  averagePerIteration(): number {
    if (this.iterationUsages.length === 0) return 0;
    return Math.round(this.totalConsumed / this.iterationUsages.length);
  }

  /**
   * Estimate how many iterations remain before the hard budget runs out,
   * based on the average spending rate.
   */
  estimatedIterationsRemaining(): number {
    const avg = this.averagePerIteration();
    if (avg === 0) return Infinity;
    return Math.floor(this.budgetRemaining() / avg);
  }

  /**
   * Estimate token count for a message array.
   * Uses a hybrid word + character heuristic: ~1.3 tokens per word for
   * natural language, ~4 characters per token for code/structured content.
   * Takes the max of both estimates to handle mixed content.
   */
  estimateContextTokens(messages: AgentMessage[]): number {
    let totalChars = 0;
    let totalWords = 0;
    for (const msg of messages) {
      if (msg.content) {
        totalChars += msg.content.length;
        // Split on whitespace; filter empty strings from consecutive spaces
        totalWords += msg.content.split(/\s+/).filter(Boolean).length;
      }
      // Tool calls contribute tokens too (only on assistant messages)
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const argStr = JSON.stringify(tc.arguments);
          totalChars += tc.name.length + argStr.length;
          totalWords += argStr.split(/\s+/).filter(Boolean).length;
        }
      }
    }
    return Math.max(Math.ceil(totalWords * 1.3), Math.ceil(totalChars / 4));
  }

  /**
   * Create a child budget tracker for a sub-agent.
   * The sub-agent gets a fraction of the parent's remaining budget
   * (default: 25%). This prevents sub-agents from consuming the entire
   * token budget.
   */
  createSubAgentBudget(fraction = 0.25): ContextBudgetTracker {
    const remaining = this.budgetRemaining();
    const subBudget = Math.floor(remaining * fraction);

    return new ContextBudgetTracker({
      contextLimit: this.contextLimit,
      maxTotalTokens: subBudget,
      microThreshold: this.microThreshold,
      progressiveThreshold: this.progressiveThreshold,
      fullThreshold: this.fullThreshold,
      warningThreshold: this.warningThreshold,
      criticalThreshold: this.criticalThreshold,
    });
  }

  /**
   * Check if a single iteration would exceed its per-iteration budget.
   * Uses the average spending rate to estimate what a "normal" iteration costs
   * and flags if the last iteration used more than 3x the average.
   */
  isIterationOverBudget(): boolean {
    if (this.iterationUsages.length < 2) return false;
    const avg = this.averagePerIteration();
    const last = this.iterationUsages.at(-1)!;
    return last > avg * 3;
  }

  /**
   * Emit budget alerts when spending crosses warning/critical thresholds.
   * Each level is emitted at most once per tracker lifetime.
   */
  private checkBudgetAlerts(): void {
    if (!this.onBudgetAlert) return;

    const utilization = this.totalConsumed / this.maxTotalTokens;
    const remaining = this.budgetRemaining();

    // Emit warning before critical (if we jumped past the warning threshold)
    if (utilization >= this.warningThreshold && !this.emittedAlerts.has("warning")) {
      this.emittedAlerts.add("warning");
      this.onBudgetAlert({
        level: "warning",
        message: `Approaching token budget limit: ${remaining.toLocaleString()} tokens remaining (${Math.round(utilization * 100)}% consumed)`,
        budgetUtilization: utilization,
        tokensRemaining: remaining,
      });
    }

    if (utilization >= this.criticalThreshold && !this.emittedAlerts.has("critical")) {
      this.emittedAlerts.add("critical");
      this.onBudgetAlert({
        level: "critical",
        message: `Token budget critically low: ${remaining.toLocaleString()} tokens remaining (${Math.round(utilization * 100)}% consumed)`,
        budgetUtilization: utilization,
        tokensRemaining: remaining,
      });
    }
  }

  private tierFromUtilization(utilization: number): CompactionTier {
    if (utilization >= this.fullThreshold) return "full";
    if (utilization >= this.progressiveThreshold) return "progressive";
    if (utilization >= this.microThreshold) return "micro";
    return "none";
  }
}
