import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenTracker } from "./token-tracker";

describe("TokenTracker (E-7)", () => {
  const originalEnv = process.env.DOJOPS_DAILY_TOKEN_BUDGET;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.DOJOPS_DAILY_TOKEN_BUDGET = originalEnv;
    } else {
      delete process.env.DOJOPS_DAILY_TOKEN_BUDGET;
    }
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("uses provided budget", () => {
      const tracker = new TokenTracker(500_000);
      const summary = tracker.getSummary();
      expect(summary.budget).toBe(500_000);
    });

    it("defaults to 1_000_000 without env", () => {
      delete process.env.DOJOPS_DAILY_TOKEN_BUDGET;
      const tracker = new TokenTracker();
      expect(tracker.getSummary().budget).toBe(1_000_000);
    });

    it("reads DOJOPS_DAILY_TOKEN_BUDGET env var", () => {
      process.env.DOJOPS_DAILY_TOKEN_BUDGET = "250000";
      const tracker = new TokenTracker();
      expect(tracker.getSummary().budget).toBe(250_000);
    });

    it("initializes with zero tokens", () => {
      const tracker = new TokenTracker(1000);
      const summary = tracker.getSummary();
      expect(summary.totalTokens).toBe(0);
      expect(summary.percentUsed).toBe(0);
    });
  });

  describe("record()", () => {
    it("accumulates tokens across calls", () => {
      const tracker = new TokenTracker(10_000);
      tracker.record(100);
      tracker.record(200);
      tracker.record(300);
      expect(tracker.getSummary().totalTokens).toBe(600);
    });

    it("warns when budget exceeded", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tracker = new TokenTracker(100);
      tracker.record(150);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Daily token budget exceeded: 150/100"),
      );
    });

    it("does not warn under budget", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tracker = new TokenTracker(1000);
      tracker.record(500);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns on each call after exceeded", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tracker = new TokenTracker(100);
      tracker.record(101);
      tracker.record(50);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it("handles zero token records", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const tracker = new TokenTracker(100);
      tracker.record(0);
      tracker.record(0);
      expect(tracker.getSummary().totalTokens).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("getSummary()", () => {
    it("returns YYYY-MM-DD date", () => {
      const tracker = new TokenTracker(1000);
      const summary = tracker.getSummary();
      expect(summary.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("calculates percentUsed correctly", () => {
      const tracker = new TokenTracker(1000);
      tracker.record(250);
      const summary = tracker.getSummary();
      expect(summary.percentUsed).toBe(25);
    });

    it("rounds percentUsed to 2 decimals", () => {
      const tracker = new TokenTracker(3);
      tracker.record(1);
      const summary = tracker.getSummary();
      // 1/3 = 33.333... -> should round to 33.33
      expect(summary.percentUsed).toBe(33.33);
    });

    it("returns 0 percentUsed when budget is 0", () => {
      const tracker = new TokenTracker(0);
      tracker.record(100);
      expect(tracker.getSummary().percentUsed).toBe(0);
    });

    it("returns all fields", () => {
      const tracker = new TokenTracker(500);
      tracker.record(100);
      const summary = tracker.getSummary();
      expect(summary).toHaveProperty("date");
      expect(summary).toHaveProperty("totalTokens", 100);
      expect(summary).toHaveProperty("budget", 500);
      expect(summary).toHaveProperty("percentUsed", 20);
    });
  });

  describe("daily reset", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resets tokens when date changes", () => {
      vi.setSystemTime(new Date("2026-02-28T10:00:00Z"));
      const tracker = new TokenTracker(10_000);
      tracker.record(5000);
      expect(tracker.getSummary().totalTokens).toBe(5000);

      // Advance to next day
      vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
      tracker.record(100);
      expect(tracker.getSummary().totalTokens).toBe(100);
    });

    it("preserves within same day", () => {
      vi.setSystemTime(new Date("2026-02-28T10:00:00Z"));
      const tracker = new TokenTracker(10_000);
      tracker.record(1000);

      // Same day, later time
      vi.setSystemTime(new Date("2026-02-28T23:59:59Z"));
      tracker.record(2000);
      expect(tracker.getSummary().totalTokens).toBe(3000);
    });

    it("resets on getSummary() when date changes", () => {
      vi.setSystemTime(new Date("2026-02-28T10:00:00Z"));
      const tracker = new TokenTracker(10_000);
      tracker.record(5000);

      vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
      const summary = tracker.getSummary();
      expect(summary.totalTokens).toBe(0);
      expect(summary.date).toBe("2026-03-01");
    });
  });
});
