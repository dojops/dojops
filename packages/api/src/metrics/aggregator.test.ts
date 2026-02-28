import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { MetricsAggregator } from "./aggregator";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-metrics-test-"));
}

function setupOda(rootDir: string) {
  const dojopsDir = path.join(rootDir, ".dojops");
  fs.mkdirSync(path.join(dojopsDir, "plans"), { recursive: true });
  fs.mkdirSync(path.join(dojopsDir, "execution-logs"), { recursive: true });
  fs.mkdirSync(path.join(dojopsDir, "scan-history"), { recursive: true });
  fs.mkdirSync(path.join(dojopsDir, "history"), { recursive: true });
  return dojopsDir;
}

function writePlan(dojopsDir: string, plan: Record<string, unknown>) {
  fs.writeFileSync(path.join(dojopsDir, "plans", `${plan.id}.json`), JSON.stringify(plan));
}

function writeExecution(dojopsDir: string, record: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dojopsDir, "execution-logs", `${record.planId}-${Date.now()}.json`),
    JSON.stringify(record),
  );
}

function writeScanReport(dojopsDir: string, report: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dojopsDir, "scan-history", `${report.id}.json`),
    JSON.stringify(report),
  );
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

describe("MetricsAggregator", () => {
  let rootDir: string;
  let dojopsDir: string;

  beforeEach(() => {
    rootDir = createTempDir();
    dojopsDir = setupOda(rootDir);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe("getOverview()", () => {
    it("returns zero values when no data exists", () => {
      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();
      expect(result.totalPlans).toBe(0);
      expect(result.totalExecutions).toBe(0);
      expect(result.successRate).toBe(0);
      expect(result.avgExecutionTimeMs).toBe(0);
      expect(result.totalScans).toBe(0);
      expect(result.totalFindings).toBe(0);
      expect(result.criticalFindings).toBe(0);
      expect(result.highFindings).toBe(0);
      expect(result.mostUsedAgents).toEqual([]);
      expect(result.failureReasons).toEqual([]);
      expect(result.recentActivity).toEqual([]);
    });

    it("computes correct totals from plans and executions", () => {
      writePlan(dojopsDir, {
        id: "plan-1",
        goal: "test",
        createdAt: "2024-01-01",
        risk: "LOW",
        tasks: [],
        approvalStatus: "APPLIED",
      });
      writePlan(dojopsDir, {
        id: "plan-2",
        goal: "test2",
        createdAt: "2024-01-02",
        risk: "MEDIUM",
        tasks: [],
        approvalStatus: "PENDING",
      });

      writeExecution(dojopsDir, {
        planId: "plan-1",
        executedAt: "2024-01-01",
        status: "SUCCESS",
        filesCreated: [],
        filesModified: [],
        durationMs: 1000,
      });
      writeExecution(dojopsDir, {
        planId: "plan-2",
        executedAt: "2024-01-02",
        status: "FAILURE",
        filesCreated: [],
        filesModified: [],
        durationMs: 2000,
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();

      expect(result.totalPlans).toBe(2);
      expect(result.totalExecutions).toBe(2);
      expect(result.successRate).toBe(50);
      expect(result.avgExecutionTimeMs).toBe(1500);
    });

    it("aggregates scan findings from summary", () => {
      writeScanReport(dojopsDir, {
        id: "scan-1",
        timestamp: "2024-01-01T00:00:00Z",
        findings: [],
        summary: { total: 10, critical: 2, high: 3, medium: 4, low: 1 },
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();

      expect(result.totalScans).toBe(1);
      expect(result.totalFindings).toBe(10);
      expect(result.criticalFindings).toBe(2);
      expect(result.highFindings).toBe(3);
    });

    it("aggregates scan findings from individual findings when no summary", () => {
      writeScanReport(dojopsDir, {
        id: "scan-2",
        timestamp: "2024-01-01T00:00:00Z",
        findings: [
          { message: "vuln1", severity: "critical", tool: "test" },
          { message: "vuln2", severity: "high", tool: "test" },
          { message: "vuln3", severity: "medium", tool: "test" },
        ],
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();

      expect(result.totalFindings).toBe(3);
      expect(result.criticalFindings).toBe(1);
      expect(result.highFindings).toBe(1);
    });

    it("extracts most used agents from audit entries", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          status: "success",
          durationMs: 200,
        },
        {
          timestamp: "2024-01-01T00:02:00Z",
          user: "test",
          command: "apply",
          action: "execute",
          status: "success",
          durationMs: 300,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getOverview();

      expect(result.mostUsedAgents).toEqual([
        { agent: "plan", count: 2 },
        { agent: "apply", count: 1 },
      ]);
    });
  });

  describe("getSecurity()", () => {
    it("returns zero values when no scans exist", () => {
      const agg = new MetricsAggregator(rootDir);
      const result = agg.getSecurity();
      expect(result.totalScans).toBe(0);
      expect(result.totalFindings).toBe(0);
      expect(result.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
      expect(result.byCategory).toEqual({ security: 0, dependency: 0, iac: 0, secrets: 0 });
    });

    it("aggregates severity breakdown", () => {
      writeScanReport(dojopsDir, {
        id: "scan-1",
        timestamp: "2024-01-01T00:00:00Z",
        findings: [
          { message: "vuln1", severity: "critical", tool: "tool1", category: "security" },
          { message: "vuln2", severity: "high", tool: "tool1", category: "dependency" },
          { message: "vuln3", severity: "medium", tool: "tool2", category: "iac" },
          { message: "vuln4", severity: "low", tool: "tool2", category: "secrets" },
        ],
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getSecurity();

      expect(result.totalFindings).toBe(4);
      expect(result.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
      expect(result.byCategory).toEqual({ security: 1, dependency: 1, iac: 1, secrets: 1 });
    });

    it("handles uppercase severity and category from scanners", () => {
      writeScanReport(dojopsDir, {
        id: "scan-upper",
        timestamp: "2024-01-01T00:00:00Z",
        findings: [
          { message: "vuln1", severity: "CRITICAL", tool: "trivy", category: "SECURITY" },
          { message: "vuln2", severity: "HIGH", tool: "npm-audit", category: "DEPENDENCY" },
          { message: "vuln3", severity: "MEDIUM", tool: "checkov", category: "IAC" },
          { message: "vuln4", severity: "LOW", tool: "gitleaks", category: "SECRETS" },
        ],
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getSecurity();

      expect(result.totalFindings).toBe(4);
      expect(result.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
      expect(result.byCategory).toEqual({ security: 1, dependency: 1, iac: 1, secrets: 1 });
    });

    it("groups findings trend by date", () => {
      writeScanReport(dojopsDir, {
        id: "scan-1",
        timestamp: "2024-01-15T10:00:00Z",
        findings: [
          { message: "vuln1", severity: "critical", tool: "tool1" },
          { message: "vuln2", severity: "high", tool: "tool1" },
        ],
      });
      writeScanReport(dojopsDir, {
        id: "scan-2",
        timestamp: "2024-01-16T10:00:00Z",
        findings: [{ message: "vuln3", severity: "medium", tool: "tool1" }],
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getSecurity();

      expect(result.findingsTrend).toHaveLength(2);
      expect(result.findingsTrend[0].date).toBe("2024-01-15");
      expect(result.findingsTrend[0].critical).toBe(1);
      expect(result.findingsTrend[0].high).toBe(1);
      expect(result.findingsTrend[1].date).toBe("2024-01-16");
      expect(result.findingsTrend[1].medium).toBe(1);
    });

    it("ranks top issues by count", () => {
      writeScanReport(dojopsDir, {
        id: "scan-1",
        timestamp: "2024-01-01T00:00:00Z",
        findings: [
          { message: "repeated issue", severity: "high", tool: "tool1" },
          { message: "repeated issue", severity: "high", tool: "tool1" },
          { message: "unique issue", severity: "critical", tool: "tool2" },
        ],
      });

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getSecurity();

      expect(result.topIssues[0].message).toBe("repeated issue");
      expect(result.topIssues[0].count).toBe(2);
      expect(result.topIssues[1].message).toBe("unique issue");
      expect(result.topIssues[1].count).toBe(1);
    });
  });

  describe("getAudit()", () => {
    it("returns empty state when no audit file exists", () => {
      const agg = new MetricsAggregator(rootDir);
      const result = agg.getAudit();
      expect(result.totalEntries).toBe(0);
      expect(result.chainIntegrity.valid).toBe(true);
      expect(result.chainIntegrity.totalEntries).toBe(0);
      expect(result.byStatus).toEqual({ success: 0, failure: 0, cancelled: 0 });
    });

    it("verifies valid audit chain", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "apply",
          action: "execute",
          status: "failure",
          durationMs: 200,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getAudit();

      expect(result.totalEntries).toBe(2);
      expect(result.chainIntegrity.valid).toBe(true);
      expect(result.chainIntegrity.errors).toBe(0);
      expect(result.byStatus).toEqual({ success: 1, failure: 1, cancelled: 0 });
    });

    it("detects tampered audit chain", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          status: "success",
          durationMs: 100,
        },
      ]);

      // Tamper with the file
      const auditFile = path.join(dojopsDir, "history", "audit.jsonl");
      const content = fs.readFileSync(auditFile, "utf-8");
      const entry = JSON.parse(content.trim());
      entry.status = "failure"; // tamper
      fs.writeFileSync(auditFile, JSON.stringify(entry) + "\n");

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getAudit();

      expect(result.chainIntegrity.valid).toBe(false);
      expect(result.chainIntegrity.errors).toBeGreaterThan(0);
    });

    it("computes command distribution", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "plan",
          action: "decompose",
          status: "success",
          durationMs: 200,
        },
        {
          timestamp: "2024-01-01T00:02:00Z",
          user: "test",
          command: "apply",
          action: "execute",
          status: "success",
          durationMs: 300,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getAudit();

      expect(result.byCommand).toEqual([
        { command: "plan", count: 2 },
        { command: "apply", count: 1 },
      ]);
    });

    it("returns timeline in reverse order (newest first)", () => {
      writeAuditEntries(dojopsDir, [
        {
          timestamp: "2024-01-01T00:00:00Z",
          user: "test",
          command: "plan",
          action: "first",
          status: "success",
          durationMs: 100,
        },
        {
          timestamp: "2024-01-01T00:01:00Z",
          user: "test",
          command: "apply",
          action: "second",
          status: "success",
          durationMs: 200,
        },
      ]);

      const agg = new MetricsAggregator(rootDir);
      const result = agg.getAudit();

      expect(result.timeline[0].action).toBe("second");
      expect(result.timeline[1].action).toBe("first");
    });
  });

  describe("getAll()", () => {
    it("returns combined metrics with timestamp", () => {
      const agg = new MetricsAggregator(rootDir);
      const result = agg.getAll();

      expect(result.overview).toBeDefined();
      expect(result.security).toBeDefined();
      expect(result.audit).toBeDefined();
      expect(result.generatedAt).toBeDefined();
    });
  });

  describe("graceful handling", () => {
    it("handles missing .dojops directory", () => {
      const emptyRoot = createTempDir();
      const agg = new MetricsAggregator(emptyRoot);

      expect(agg.getOverview().totalPlans).toBe(0);
      expect(agg.getSecurity().totalScans).toBe(0);
      expect(agg.getAudit().totalEntries).toBe(0);

      fs.rmSync(emptyRoot, { recursive: true, force: true });
    });

    it("handles corrupt JSON files gracefully", () => {
      fs.writeFileSync(path.join(dojopsDir, "plans", "bad.json"), "not json");
      fs.writeFileSync(path.join(dojopsDir, "scan-history", "bad.json"), "{invalid");

      const agg = new MetricsAggregator(rootDir);
      expect(agg.getOverview().totalPlans).toBe(0);
      expect(agg.getSecurity().totalScans).toBe(0);
    });
  });
});
