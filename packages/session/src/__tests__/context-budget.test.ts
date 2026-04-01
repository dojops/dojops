import { describe, it, expect } from "vitest";
import { ContextBudgetTracker, PROVIDER_CONTEXT_LIMITS } from "../context-budget";
import type { BudgetAlert } from "../context-budget";
import type { AgentMessage, LLMUsage } from "@dojops/core";

function makeUsage(total: number): LLMUsage {
  return {
    promptTokens: Math.floor(total * 0.7),
    completionTokens: Math.ceil(total * 0.3),
    totalTokens: total,
  };
}

function makeMessages(count: number, contentLength = 100): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(contentLength),
    });
  }
  return msgs;
}

describe("ContextBudgetTracker", () => {
  describe("constructor defaults", () => {
    it("uses default context limit when no provider specified", () => {
      const tracker = new ContextBudgetTracker();
      const snap = tracker.getSnapshot();
      expect(snap.contextLimit).toBe(128_000);
    });

    it("looks up provider context limit", () => {
      const tracker = new ContextBudgetTracker({ providerName: "anthropic" });
      expect(tracker.getSnapshot().contextLimit).toBe(200_000);
    });

    it("allows explicit context limit override", () => {
      const tracker = new ContextBudgetTracker({
        providerName: "anthropic",
        contextLimit: 50_000,
      });
      expect(tracker.getSnapshot().contextLimit).toBe(50_000);
    });
  });

  describe("PROVIDER_CONTEXT_LIMITS", () => {
    it("contains all expected providers", () => {
      expect(PROVIDER_CONTEXT_LIMITS.openai).toBe(128_000);
      expect(PROVIDER_CONTEXT_LIMITS.anthropic).toBe(200_000);
      expect(PROVIDER_CONTEXT_LIMITS.ollama).toBe(32_000);
      expect(PROVIDER_CONTEXT_LIMITS.gemini).toBe(1_000_000);
    });
  });

  describe("recordUsage", () => {
    it("accumulates total tokens consumed", () => {
      const tracker = new ContextBudgetTracker();
      tracker.recordUsage(makeUsage(1000));
      tracker.recordUsage(makeUsage(2000));
      expect(tracker.getSnapshot().totalConsumed).toBe(3000);
    });
  });

  describe("isBudgetExhausted", () => {
    it("returns false when under budget", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      tracker.recordUsage(makeUsage(5000));
      expect(tracker.isBudgetExhausted()).toBe(false);
    });

    it("returns true when budget reached", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      tracker.recordUsage(makeUsage(10_000));
      expect(tracker.isBudgetExhausted()).toBe(true);
    });

    it("returns true when budget exceeded", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      tracker.recordUsage(makeUsage(15_000));
      expect(tracker.isBudgetExhausted()).toBe(true);
    });
  });

  describe("budgetRemaining", () => {
    it("returns remaining tokens", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      tracker.recordUsage(makeUsage(3000));
      expect(tracker.budgetRemaining()).toBe(7000);
    });

    it("returns 0 when exhausted", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      tracker.recordUsage(makeUsage(15_000));
      expect(tracker.budgetRemaining()).toBe(0);
    });
  });

  describe("evaluate", () => {
    it("returns 'none' when context is small", () => {
      const tracker = new ContextBudgetTracker({ contextLimit: 100_000 });
      // 10 messages x 100 chars = ~250 tokens (well under 50% of 100K)
      const tier = tracker.evaluate(makeMessages(10, 100));
      expect(tier).toBe("none");
    });

    it("returns 'micro' at 50% utilization", () => {
      const tracker = new ContextBudgetTracker({
        contextLimit: 1000,
        microThreshold: 0.5,
      });
      // ~600 tokens worth of content (>50% of 1000)
      const msgs = makeMessages(3, 800);
      const tier = tracker.evaluate(msgs);
      expect(tier).toBe("micro");
    });

    it("returns 'progressive' at 70% utilization", () => {
      const tracker = new ContextBudgetTracker({
        contextLimit: 1000,
        progressiveThreshold: 0.7,
      });
      const msgs = makeMessages(4, 800);
      const tier = tracker.evaluate(msgs);
      expect(tier).toBe("progressive");
    });

    it("returns 'full' at 85% utilization", () => {
      const tracker = new ContextBudgetTracker({
        contextLimit: 1000,
        fullThreshold: 0.85,
      });
      const msgs = makeMessages(5, 800);
      const tier = tracker.evaluate(msgs);
      expect(tier).toBe("full");
    });
  });

  describe("estimateContextTokens", () => {
    it("estimates tokens from message content", () => {
      const tracker = new ContextBudgetTracker();
      const msgs: AgentMessage[] = [
        { role: "user", content: "Hello world" },
        { role: "assistant", content: "Hi there" },
      ];
      const estimate = tracker.estimateContextTokens(msgs);
      // "Hello world" = 2 words, "Hi there" = 2 words => 4 words * 1.3 = 5.2 → 6
      // Total chars = 19, 19/4 = 4.75 → 5
      // Max(6, 5) = 6
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(50);
    });

    it("accounts for tool call arguments", () => {
      const tracker = new ContextBudgetTracker();
      const msgs: AgentMessage[] = [
        {
          role: "assistant",
          content: "Running tool",
          toolCalls: [
            {
              id: "t1",
              name: "write_file",
              arguments: { path: "/tmp/test.ts", content: "a".repeat(500) },
            },
          ],
        },
      ];
      const withCalls = tracker.estimateContextTokens(msgs);
      const withoutCalls = tracker.estimateContextTokens([
        { role: "assistant", content: "Running tool" },
      ]);
      expect(withCalls).toBeGreaterThan(withoutCalls);
    });

    it("handles empty messages", () => {
      const tracker = new ContextBudgetTracker();
      expect(tracker.estimateContextTokens([])).toBe(0);
    });
  });

  describe("recordCompaction", () => {
    it("increments compaction count", () => {
      const tracker = new ContextBudgetTracker();
      expect(tracker.getSnapshot().compactionCount).toBe(0);
      tracker.recordCompaction([]);
      expect(tracker.getSnapshot().compactionCount).toBe(1);
      tracker.recordCompaction([]);
      expect(tracker.getSnapshot().compactionCount).toBe(2);
    });
  });

  describe("forceFullCompaction", () => {
    it("returns full tier and increments count", () => {
      const tracker = new ContextBudgetTracker();
      const tier = tracker.forceFullCompaction();
      expect(tier).toBe("full");
      expect(tracker.getSnapshot().compactionCount).toBe(1);
    });
  });

  describe("averagePerIteration", () => {
    it("returns 0 when no iterations recorded", () => {
      const tracker = new ContextBudgetTracker();
      expect(tracker.averagePerIteration()).toBe(0);
    });

    it("calculates average across iterations", () => {
      const tracker = new ContextBudgetTracker();
      tracker.recordUsage(makeUsage(1000));
      tracker.recordUsage(makeUsage(3000));
      expect(tracker.averagePerIteration()).toBe(2000);
    });
  });

  describe("estimatedIterationsRemaining", () => {
    it("returns Infinity when no usage recorded", () => {
      const tracker = new ContextBudgetTracker();
      expect(tracker.estimatedIterationsRemaining()).toBe(Infinity);
    });

    it("estimates remaining iterations from average", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      tracker.recordUsage(makeUsage(2000));
      tracker.recordUsage(makeUsage(2000));
      // Avg = 2000, remaining = 6000, iterations = 3
      expect(tracker.estimatedIterationsRemaining()).toBe(3);
    });
  });

  describe("getSnapshot", () => {
    it("returns complete budget state", () => {
      const tracker = new ContextBudgetTracker({
        providerName: "openai",
        maxTotalTokens: 50_000,
      });
      tracker.recordUsage(makeUsage(5000));
      tracker.evaluate(makeMessages(2, 100));

      const snap = tracker.getSnapshot();
      expect(snap.totalConsumed).toBe(5000);
      expect(snap.contextLimit).toBe(128_000);
      expect(snap.estimatedContextTokens).toBeGreaterThan(0);
      expect(snap.utilization).toBeGreaterThanOrEqual(0);
      expect(snap.utilization).toBeLessThanOrEqual(1);
      expect(snap.compactionCount).toBe(0);
      expect(snap.recommendedAction).toBe("none");
    });

    it("caps utilization at 1", () => {
      const tracker = new ContextBudgetTracker({ contextLimit: 10 });
      tracker.evaluate(makeMessages(10, 1000));
      const snap = tracker.getSnapshot();
      expect(snap.utilization).toBe(1);
    });
  });

  describe("budget alerts", () => {
    it("emits warning alert at 80% budget usage", () => {
      const alerts: BudgetAlert[] = [];
      const tracker = new ContextBudgetTracker({
        maxTotalTokens: 10_000,
        warningThreshold: 0.8,
        onBudgetAlert: (a) => alerts.push(a),
      });

      tracker.recordUsage(makeUsage(7000)); // 70% — no alert
      expect(alerts).toHaveLength(0);

      tracker.recordUsage(makeUsage(1500)); // 85% — warning
      expect(alerts).toHaveLength(1);
      expect(alerts[0].level).toBe("warning");
      expect(alerts[0].budgetUtilization).toBeGreaterThanOrEqual(0.8);
    });

    it("emits critical alert at 95% budget usage", () => {
      const alerts: BudgetAlert[] = [];
      const tracker = new ContextBudgetTracker({
        maxTotalTokens: 10_000,
        warningThreshold: 0.8,
        criticalThreshold: 0.95,
        onBudgetAlert: (a) => alerts.push(a),
      });

      tracker.recordUsage(makeUsage(9600)); // 96% — both warning + critical
      expect(alerts).toHaveLength(2);
      expect(alerts[0].level).toBe("warning");
      expect(alerts[1].level).toBe("critical");
    });

    it("emits each alert level only once", () => {
      const alerts: BudgetAlert[] = [];
      const tracker = new ContextBudgetTracker({
        maxTotalTokens: 10_000,
        warningThreshold: 0.8,
        onBudgetAlert: (a) => alerts.push(a),
      });

      tracker.recordUsage(makeUsage(8500)); // 85% — warning
      tracker.recordUsage(makeUsage(500)); // 90% — no duplicate
      expect(alerts).toHaveLength(1);
    });

    it("does not emit when no callback provided", () => {
      const tracker = new ContextBudgetTracker({ maxTotalTokens: 100 });
      // Should not throw even at 100% usage
      tracker.recordUsage(makeUsage(100));
      expect(tracker.isBudgetExhausted()).toBe(true);
    });
  });

  describe("createSubAgentBudget", () => {
    it("creates child tracker with fraction of remaining budget", () => {
      const parent = new ContextBudgetTracker({ maxTotalTokens: 100_000 });
      parent.recordUsage(makeUsage(60_000)); // 60% consumed, 40K remaining

      const child = parent.createSubAgentBudget(0.25);
      const childSnap = child.getSnapshot();
      // Child gets 25% of 40K = 10K
      expect(childSnap.contextLimit).toBe(parent.getSnapshot().contextLimit);
      child.recordUsage(makeUsage(10_000));
      expect(child.isBudgetExhausted()).toBe(true);
    });

    it("defaults to 25% fraction", () => {
      const parent = new ContextBudgetTracker({ maxTotalTokens: 100_000 });
      // 0 consumed, 100K remaining → child gets 25K
      const child = parent.createSubAgentBudget();
      child.recordUsage(makeUsage(24_000));
      expect(child.isBudgetExhausted()).toBe(false);
      child.recordUsage(makeUsage(2_000));
      expect(child.isBudgetExhausted()).toBe(true);
    });

    it("child budget is 0 when parent is exhausted", () => {
      const parent = new ContextBudgetTracker({ maxTotalTokens: 10_000 });
      parent.recordUsage(makeUsage(10_000));

      const child = parent.createSubAgentBudget();
      expect(child.isBudgetExhausted()).toBe(true);
    });
  });

  describe("isIterationOverBudget", () => {
    it("returns false with less than 2 iterations", () => {
      const tracker = new ContextBudgetTracker();
      tracker.recordUsage(makeUsage(1000));
      expect(tracker.isIterationOverBudget()).toBe(false);
    });

    it("returns false when last iteration is within normal range", () => {
      const tracker = new ContextBudgetTracker();
      tracker.recordUsage(makeUsage(1000));
      tracker.recordUsage(makeUsage(1200));
      tracker.recordUsage(makeUsage(1100));
      expect(tracker.isIterationOverBudget()).toBe(false);
    });

    it("returns true when last iteration is 3x+ the average", () => {
      const tracker = new ContextBudgetTracker();
      // Record many normal iterations to establish a low average, then spike
      for (let i = 0; i < 10; i++) {
        tracker.recordUsage(makeUsage(1000));
      }
      // Average is now 1000, 10K spike (10x avg, well above 3x)
      tracker.recordUsage(makeUsage(10_000));
      expect(tracker.isIterationOverBudget()).toBe(true);
    });
  });
});
