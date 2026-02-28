import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { MetricsAggregator } from "./aggregator";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-agents-test-"));
}

function setupDojops(rootDir: string) {
  const dojopsDir = path.join(rootDir, ".dojops");
  fs.mkdirSync(path.join(dojopsDir, "history"), { recursive: true });
  return dojopsDir;
}

function computeAuditHash(entry: Record<string, unknown>): string {
  const payload = [
    entry.seq,
    entry.timestamp,
    entry.user,
    entry.command,
    entry.action,
    (entry.planId as string) ?? "",
    entry.status,
    entry.durationMs,
    (entry.previousHash as string) ?? "genesis",
  ].join("\0");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function writeAuditEntries(dojopsDir: string, entries: Array<Record<string, unknown>>) {
  let previousHash = "genesis";
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = { ...entries[i], seq: i + 1, previousHash };
    e.hash = computeAuditHash(e);
    previousHash = e.hash as string;
    lines.push(JSON.stringify(e));
  }
  fs.writeFileSync(path.join(dojopsDir, "history", "audit.jsonl"), lines.join("\n") + "\n");
}

describe("MetricsAggregator mostUsedAgents (M-2)", () => {
  let rootDir: string;
  let dojopsDir: string;

  beforeEach(() => {
    rootDir = createTempDir();
    dojopsDir = setupDojops(rootDir);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe("agent field extraction", () => {
    it("uses entry.agent when present (not command string)", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "generate terraform config",
          action: "generate",
          agent: "terraform-specialist",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents).toEqual([{ agent: "terraform-specialist", count: 1 }]);
    });

    it("falls back to command verb when agent absent", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan deploy infra",
          action: "decompose",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents).toEqual([{ agent: "plan", count: 1 }]);
    });

    it("agent field takes priority over command", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "generate",
          action: "generate",
          agent: "security-auditor",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents[0].agent).toBe("security-auditor");
    });

    it('uses "unknown" when both missing', () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "",
          action: "test",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents[0].agent).toBe("unknown");
    });
  });

  describe("aggregation", () => {
    it("counts multiple entries for same agent correctly", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "generate",
          action: "generate",
          agent: "terraform-specialist",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "generate",
          action: "generate",
          agent: "terraform-specialist",
          status: "success",
          durationMs: 200,
        },
        {
          timestamp: "2024-01-01T00:02:00Z",
          user: "test",
          command: "generate",
          action: "generate",
          agent: "terraform-specialist",
          status: "success",
          durationMs: 300,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents).toEqual([{ agent: "terraform-specialist", count: 3 }]);
    });

    it("sorts agents by count descending", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "g",
          action: "g",
          agent: "agent-b",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "g",
          action: "g",
          agent: "agent-a",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:02:00Z",
          user: "test",
          command: "g",
          action: "g",
          agent: "agent-a",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:03:00Z",
          user: "test",
          command: "g",
          action: "g",
          agent: "agent-a",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents[0]).toEqual({ agent: "agent-a", count: 3 });
      expect(result.mostUsedAgents[1]).toEqual({ agent: "agent-b", count: 1 });
    });

    it("limits to top 10", () => {
      const entries = [];
      for (let i = 0; i < 15; i++) {
        entries.push({
          timestamp: `2024-01-01T00:${String(i).padStart(2, "0")}:00Z`,
          user: "test",
          command: `cmd-${i}`,
          action: "test",
          agent: `agent-${i}`,
          status: "success",
          durationMs: 100,
        });
      }
      writeAuditEntries(dojopsDir, entries);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents.length).toBeLessThanOrEqual(10);
    });

    it("handles mix of entries with/without agent field", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          agent: "ops-cortex",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "apply",
          action: "execute",
          status: "success",
          durationMs: 200,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      const agents = result.mostUsedAgents.map((a) => a.agent);
      expect(agents).toContain("ops-cortex");
      expect(agents).toContain("apply");
    });
  });

  describe("edge cases", () => {
    it('empty command string → "unknown"', () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "",
          action: "test",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents[0].agent).toBe("unknown");
    });

    it("command with no spaces → uses single word", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "scan",
          action: "scan",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents[0].agent).toBe("scan");
    });

    it("agent field as empty string → falls back to command", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "generate",
          action: "generate",
          agent: "",
          status: "success",
          durationMs: 100,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      // Empty string is falsy, so should fall back to command verb
      expect(result.mostUsedAgents[0].agent).toBe("generate");
    });

    it("returns empty array when no audit entries", () => {
      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.mostUsedAgents).toEqual([]);
    });
  });
});
