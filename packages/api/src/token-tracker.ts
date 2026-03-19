import fs from "node:fs";
import path from "node:path";

/**
 * Daily token budget tracker (E-7 + G-18).
 * Tracks cumulative token usage per day with optional file persistence.
 * When budget is exceeded, `checkBudget()` returns `allowed: false`.
 */
export class TokenTracker {
  private currentDate: string;
  private totalTokens: number;
  private readonly budget: number;
  private readonly persistPath: string | null;

  constructor(budget?: number, persistDir?: string) {
    this.budget = budget ?? Number.parseInt(process.env.DOJOPS_DAILY_TOKEN_BUDGET ?? "1000000", 10);
    this.currentDate = this.today();
    this.totalTokens = 0;
    this.persistPath = null;

    if (persistDir) {
      try {
        fs.mkdirSync(persistDir, { recursive: true });
        this.persistPath = path.join(persistDir, "token-usage.json");
        this.loadFromDisk();
      } catch {
        // Continue without persistence
      }
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private maybeReset(): void {
    const date = this.today();
    if (date !== this.currentDate) {
      this.currentDate = date;
      this.totalTokens = 0;
      this.saveToDisk();
    }
  }

  /** Load persisted token counts from disk. */
  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const data = JSON.parse(fs.readFileSync(this.persistPath, "utf-8"));
      if (data && typeof data.date === "string" && typeof data.totalTokens === "number") {
        // Only restore if the date matches today — otherwise start fresh
        if (data.date === this.today()) {
          this.totalTokens = data.totalTokens;
          this.currentDate = data.date;
        }
      }
    } catch {
      // Ignore read failures
    }
  }

  /** Save current token counts to disk. */
  private saveToDisk(): void {
    if (!this.persistPath) return;
    try {
      fs.writeFileSync(
        this.persistPath,
        JSON.stringify({ date: this.currentDate, totalTokens: this.totalTokens }),
      );
    } catch {
      // Ignore write failures
    }
  }

  /** Record token usage. Returns budgetExceeded flag. */
  record(tokens: number): { budgetExceeded: boolean } {
    this.maybeReset();
    this.totalTokens += tokens;
    this.saveToDisk();
    if (this.totalTokens > this.budget) {
      console.warn(
        `[TokenTracker] Daily token budget exceeded: ${this.totalTokens}/${this.budget}`,
      );
      return { budgetExceeded: true };
    }
    return { budgetExceeded: false };
  }

  /**
   * Check whether the daily budget allows further requests.
   * Returns remaining capacity and whether requests are still allowed.
   */
  checkBudget(): { allowed: boolean; remaining: number; used: number } {
    this.maybeReset();
    const remaining = Math.max(0, this.budget - this.totalTokens);
    return {
      allowed: this.totalTokens <= this.budget,
      remaining,
      used: this.totalTokens,
    };
  }

  /** Get current summary for the /api/metrics/tokens endpoint. */
  getSummary(): {
    date: string;
    totalTokens: number;
    budget: number;
    percentUsed: number;
    budgetExceeded: boolean;
  } {
    this.maybeReset();
    return {
      date: this.currentDate,
      totalTokens: this.totalTokens,
      budget: this.budget,
      percentUsed: this.budget > 0 ? Math.round((this.totalTokens / this.budget) * 10000) / 100 : 0,
      budgetExceeded: this.totalTokens > this.budget,
    };
  }
}
