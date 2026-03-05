/**
 * Simple daily token budget tracker (E-7).
 * Tracks cumulative token usage per day, in-memory only (resets on restart).
 */
export class TokenTracker {
  private currentDate: string;
  private totalTokens: number;
  private readonly budget: number;

  constructor(budget?: number) {
    this.budget = budget ?? Number.parseInt(process.env.DOJOPS_DAILY_TOKEN_BUDGET ?? "1000000", 10);
    this.currentDate = this.today();
    this.totalTokens = 0;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private maybeReset(): void {
    const date = this.today();
    if (date !== this.currentDate) {
      this.currentDate = date;
      this.totalTokens = 0;
    }
  }

  /** Record token usage. Logs a warning when budget is exceeded. */
  record(tokens: number): void {
    this.maybeReset();
    this.totalTokens += tokens;
    if (this.totalTokens > this.budget) {
      console.warn(
        `[TokenTracker] Daily token budget exceeded: ${this.totalTokens}/${this.budget}`,
      );
    }
  }

  /** Get current summary for the /api/metrics/tokens endpoint. */
  getSummary(): { date: string; totalTokens: number; budget: number; percentUsed: number } {
    this.maybeReset();
    return {
      date: this.currentDate,
      totalTokens: this.totalTokens,
      budget: this.budget,
      percentUsed: this.budget > 0 ? Math.round((this.totalTokens / this.budget) * 10000) / 100 : 0,
    };
  }
}
