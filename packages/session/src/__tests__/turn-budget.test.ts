import { describe, it, expect } from "vitest";
import { TurnBudgetTracker } from "../turn-budget";

describe("TurnBudgetTracker", () => {
  describe("constructor defaults", () => {
    it("uses 50000 max tokens by default", () => {
      const tracker = new TurnBudgetTracker();
      const status = tracker.getStatus();
      expect(status.remaining).toBe(50_000);
      expect(status.totalTokens).toBe(0);
    });

    it("uses 500 min progress delta by default", () => {
      const tracker = new TurnBudgetTracker();
      // Record a first continuation (baseline), then 3 continuations under 500
      tracker.record(1000);
      tracker.record(499);
      tracker.record(499);
      tracker.record(499);
      expect(tracker.getStatus().diminishingReturns).toBe(true);
    });

    it("uses 3 max low-progress continuations by default", () => {
      const tracker = new TurnBudgetTracker();
      tracker.record(1000); // first — baseline
      tracker.record(100); // low #1
      tracker.record(100); // low #2
      expect(tracker.getStatus().diminishingReturns).toBe(false);
      tracker.record(100); // low #3 — triggers
      expect(tracker.getStatus().diminishingReturns).toBe(true);
    });
  });

  describe("custom options", () => {
    it("overrides maxTurnTokens", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      const status = tracker.getStatus();
      expect(status.remaining).toBe(10_000);
    });

    it("overrides minProgressDelta", () => {
      const tracker = new TurnBudgetTracker({ minProgressDelta: 100 });
      tracker.record(1000); // baseline
      tracker.record(99); // low #1
      tracker.record(99); // low #2
      tracker.record(99); // low #3
      expect(tracker.getStatus().diminishingReturns).toBe(true);
    });

    it("overrides maxLowProgressContinuations", () => {
      const tracker = new TurnBudgetTracker({ maxLowProgressContinuations: 1 });
      tracker.record(1000); // baseline
      tracker.record(100); // low #1 — immediately triggers
      expect(tracker.getStatus().diminishingReturns).toBe(true);
    });
  });

  describe("record", () => {
    it("accumulates tokens correctly", () => {
      const tracker = new TurnBudgetTracker();
      tracker.record(1000);
      tracker.record(2000);
      tracker.record(3000);
      expect(tracker.getStatus().totalTokens).toBe(6000);
    });

    it("returns updated status after each call", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      const status1 = tracker.record(3000);
      expect(status1.totalTokens).toBe(3000);
      expect(status1.remaining).toBe(7000);
      expect(status1.percentUsed).toBe(30);

      const status2 = tracker.record(5000);
      expect(status2.totalTokens).toBe(8000);
      expect(status2.remaining).toBe(2000);
      expect(status2.percentUsed).toBe(80);
    });

    it("clamps remaining to 0 when over budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 1000 });
      tracker.record(1500);
      expect(tracker.getStatus().remaining).toBe(0);
    });
  });

  describe("budget exhaustion", () => {
    it("is not exhausted when under budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(5000);
      expect(tracker.getStatus().exhausted).toBe(false);
    });

    it("is exhausted when exactly at budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(10_000);
      expect(tracker.getStatus().exhausted).toBe(true);
    });

    it("is exhausted when over budget", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(15_000);
      expect(tracker.getStatus().exhausted).toBe(true);
    });
  });

  describe("diminishing returns detection", () => {
    it("does not flag first continuation as low progress", () => {
      const tracker = new TurnBudgetTracker({ maxLowProgressContinuations: 1 });
      // First continuation — even with tiny tokens, it should not count
      tracker.record(10);
      expect(tracker.getStatus().lowProgressCount).toBe(0);
      expect(tracker.getStatus().diminishingReturns).toBe(false);
    });

    it("counts low-progress continuations after the first", () => {
      const tracker = new TurnBudgetTracker();
      tracker.record(1000); // first — baseline
      tracker.record(100); // low #1
      expect(tracker.getStatus().lowProgressCount).toBe(1);
      tracker.record(200); // low #2
      expect(tracker.getStatus().lowProgressCount).toBe(2);
    });

    it("triggers after maxLowProgressContinuations reached", () => {
      const tracker = new TurnBudgetTracker({ maxLowProgressContinuations: 2 });
      tracker.record(5000); // baseline
      tracker.record(100); // low #1
      expect(tracker.getStatus().diminishingReturns).toBe(false);
      tracker.record(100); // low #2
      expect(tracker.getStatus().diminishingReturns).toBe(true);
    });

    it("resets low-progress counter on meaningful progress", () => {
      const tracker = new TurnBudgetTracker();
      tracker.record(1000); // baseline
      tracker.record(100); // low #1
      tracker.record(100); // low #2
      expect(tracker.getStatus().lowProgressCount).toBe(2);

      tracker.record(600); // meaningful — resets counter
      expect(tracker.getStatus().lowProgressCount).toBe(0);
      expect(tracker.getStatus().diminishingReturns).toBe(false);
    });
  });

  describe("nudge messages", () => {
    it("shows nudge at 90% usage", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(9100); // 91%
      const status = tracker.getStatus();
      expect(status.nudgeMessage).toBeDefined();
      expect(status.nudgeMessage).toContain("Approaching turn token budget");
      expect(status.nudgeMessage).toContain("91%");
    });

    it("does not show nudge below 90%", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(8900); // 89%
      expect(tracker.getStatus().nudgeMessage).toBeUndefined();
    });

    it("shows exhaustion message when budget exceeded", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(10_000);
      const status = tracker.getStatus();
      expect(status.nudgeMessage).toContain("exhausted");
    });

    it("shows diminishing returns message", () => {
      const tracker = new TurnBudgetTracker({
        maxTurnTokens: 100_000, // large budget so exhaustion doesn't interfere
        maxLowProgressContinuations: 2,
      });
      tracker.record(1000); // baseline
      tracker.record(100); // low #1
      tracker.record(100); // low #2
      const status = tracker.getStatus();
      expect(status.nudgeMessage).toContain("Diminishing returns");
    });

    it("prefers exhaustion message over diminishing returns", () => {
      const tracker = new TurnBudgetTracker({
        maxTurnTokens: 2000,
        maxLowProgressContinuations: 2,
      });
      tracker.record(1000); // baseline
      tracker.record(100); // low #1
      tracker.record(1000); // triggers exhaustion too (total 2100)
      // Also low-progress counter was reset by the 1000 above, so only diminishing
      // wouldn't fire. But exhaustion fires since 2100 >= 2000.
      const status = tracker.getStatus();
      expect(status.nudgeMessage).toContain("exhausted");
    });
  });

  describe("shouldStop", () => {
    it("returns false when under budget with good progress", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 100_000 });
      tracker.record(5000);
      tracker.record(5000);
      expect(tracker.shouldStop()).toBe(false);
    });

    it("returns true on budget exhaustion", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(10_000);
      expect(tracker.shouldStop()).toBe(true);
    });

    it("returns true on diminishing returns", () => {
      const tracker = new TurnBudgetTracker({ maxLowProgressContinuations: 2 });
      tracker.record(1000);
      tracker.record(100);
      tracker.record(100);
      expect(tracker.shouldStop()).toBe(true);
    });
  });

  describe("reset", () => {
    it("clears all accumulated state", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(5000);
      tracker.record(100);
      tracker.record(100);
      tracker.record(100);

      tracker.reset();

      const status = tracker.getStatus();
      expect(status.totalTokens).toBe(0);
      expect(status.remaining).toBe(10_000);
      expect(status.percentUsed).toBe(0);
      expect(status.exhausted).toBe(false);
      expect(status.diminishingReturns).toBe(false);
      expect(status.lowProgressCount).toBe(0);
      expect(status.nudgeMessage).toBeUndefined();
    });

    it("allows tracking a fresh turn after reset", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 10_000 });
      tracker.record(10_000);
      expect(tracker.shouldStop()).toBe(true);

      tracker.reset();
      expect(tracker.shouldStop()).toBe(false);

      tracker.record(3000);
      expect(tracker.getStatus().totalTokens).toBe(3000);
      expect(tracker.shouldStop()).toBe(false);
    });
  });

  describe("percentUsed calculation", () => {
    it("computes correct percentage", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 20_000 });
      tracker.record(5000); // 25%
      expect(tracker.getStatus().percentUsed).toBe(25);

      tracker.record(5000); // 50%
      expect(tracker.getStatus().percentUsed).toBe(50);
    });

    it("can exceed 100%", () => {
      const tracker = new TurnBudgetTracker({ maxTurnTokens: 1000 });
      tracker.record(1500); // 150%
      expect(tracker.getStatus().percentUsed).toBe(150);
    });
  });
});
