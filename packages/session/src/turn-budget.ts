/**
 * Per-turn token budget tracker for the agent loop.
 * Prevents runaway turns from consuming excessive tokens.
 * Detects diminishing returns when continuations produce minimal output.
 */

export interface TurnBudgetOptions {
  /** Maximum tokens per turn (default: 50000). */
  maxTurnTokens?: number;
  /** Minimum delta to not count as diminishing (default: 500). */
  minProgressDelta?: number;
  /** Number of low-progress continuations before stopping (default: 3). */
  maxLowProgressContinuations?: number;
}

export interface TurnBudgetStatus {
  /** Total tokens used in this turn. */
  totalTokens: number;
  /** Budget remaining. */
  remaining: number;
  /** Percentage of budget used. */
  percentUsed: number;
  /** Whether the budget is exhausted. */
  exhausted: boolean;
  /** Whether diminishing returns detected. */
  diminishingReturns: boolean;
  /** Number of low-progress continuations. */
  lowProgressCount: number;
  /** Nudge message if approaching limit, undefined otherwise. */
  nudgeMessage?: string;
}

export class TurnBudgetTracker {
  private readonly maxTurnTokens: number;
  private readonly minProgressDelta: number;
  private readonly maxLowProgressContinuations: number;

  private totalTokens = 0;
  private continuationCount = 0;
  private lastDelta = 0;
  private lowProgressCount = 0;

  constructor(opts?: TurnBudgetOptions) {
    this.maxTurnTokens = opts?.maxTurnTokens ?? 50_000;
    this.minProgressDelta = opts?.minProgressDelta ?? 500;
    this.maxLowProgressContinuations = opts?.maxLowProgressContinuations ?? 3;
  }

  /**
   * Record tokens used in a continuation.
   * Returns the updated budget status.
   */
  record(tokens: number): TurnBudgetStatus {
    this.lastDelta = tokens;
    this.totalTokens += tokens;
    this.continuationCount++;

    // Track diminishing returns — only after the first continuation,
    // since the first one has no prior baseline.
    if (this.continuationCount > 1 && tokens < this.minProgressDelta) {
      this.lowProgressCount++;
    } else if (tokens >= this.minProgressDelta) {
      this.lowProgressCount = 0;
    }

    return this.getStatus();
  }

  /** Get the current budget status without recording anything. */
  getStatus(): TurnBudgetStatus {
    const remaining = Math.max(0, this.maxTurnTokens - this.totalTokens);
    const percentUsed = (this.totalTokens / this.maxTurnTokens) * 100;
    const exhausted = this.totalTokens >= this.maxTurnTokens;
    const diminishingReturns = this.lowProgressCount >= this.maxLowProgressContinuations;

    let nudgeMessage: string | undefined;
    if (exhausted) {
      nudgeMessage = `Turn token budget exhausted (${this.totalTokens}/${this.maxTurnTokens} tokens). Wrap up your current task.`;
    } else if (diminishingReturns) {
      nudgeMessage = `Diminishing returns detected (${this.lowProgressCount} continuations with <${this.minProgressDelta} tokens progress). Consider wrapping up.`;
    } else if (percentUsed >= 90) {
      nudgeMessage = `Approaching turn token budget (${Math.round(percentUsed)}% used, ${remaining} tokens remaining). Start wrapping up.`;
    }

    return {
      totalTokens: this.totalTokens,
      remaining,
      percentUsed,
      exhausted,
      diminishingReturns,
      lowProgressCount: this.lowProgressCount,
      nudgeMessage,
    };
  }

  /** Whether the turn should be stopped (budget exhausted or diminishing returns). */
  shouldStop(): boolean {
    const status = this.getStatus();
    return status.exhausted || status.diminishingReturns;
  }

  /** Reset all state for a new turn. */
  reset(): void {
    this.totalTokens = 0;
    this.continuationCount = 0;
    this.lastDelta = 0;
    this.lowProgressCount = 0;
  }
}
