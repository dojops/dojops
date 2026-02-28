import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  OverviewMetrics,
  SecurityMetrics,
  AuditMetrics,
  MetricsAuditEntry,
  DashboardMetrics,
} from "./types";

interface PlanData {
  id: string;
  goal: string;
  createdAt: string;
  risk: string;
  tasks: Array<{ id: string; tool: string; description: string; dependsOn: string[] }>;
  results?: Array<{ taskId: string; status: string; error?: string }>;
  approvalStatus: string;
}

interface ExecutionData {
  planId: string;
  executedAt: string;
  status: string;
  filesCreated: string[];
  filesModified: string[];
  durationMs: number;
}

interface ScanFinding {
  message: string;
  severity: string;
  tool: string;
  category?: string;
}

interface ScanReport {
  id: string;
  timestamp: string;
  durationMs?: number;
  findings: ScanFinding[];
  summary?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

function computeAuditHash(entry: MetricsAuditEntry, hmacKey?: string | null): string {
  const payload = [
    entry.seq,
    entry.timestamp,
    entry.user,
    entry.command,
    entry.action,
    entry.planId ?? "",
    entry.status,
    entry.durationMs,
    entry.previousHash ?? "genesis",
  ].join("\0");
  if (hmacKey) {
    return crypto.createHmac("sha256", hmacKey).update(payload).digest("hex");
  }
  return crypto.createHash("sha256").update(payload).digest("hex");
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * JSON.parse with a reviver that rejects prototype-pollution keys
 * (__proto__, constructor, prototype).
 */
function safeJsonParse<T>(text: string): T {
  return JSON.parse(text, (key, value) => {
    if (DANGEROUS_KEYS.has(key)) return undefined;
    return value;
  }) as T;
}

export class MetricsAggregator {
  private readonly dojopsDir: string;
  // A32: Simple in-memory cache with 30s TTL (matches dashboard refresh interval)
  private cache: {
    overview?: { data: OverviewMetrics; ts: number };
    security?: { data: SecurityMetrics; ts: number };
    audit?: { data: AuditMetrics; ts: number };
  } = {};
  private readonly TTL = 30_000;

  constructor(private rootDir: string) {
    this.dojopsDir = path.join(rootDir, ".dojops");
  }

  private loadHmacKey(): string | null {
    try {
      return fs.readFileSync(path.join(this.dojopsDir, "audit-key"), "utf-8").trim();
    } catch {
      return null;
    }
  }

  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  private static readonly MAX_AUDIT_LINES = 10_000;
  private static readonly MAX_TOP_ISSUES = 100;

  private readJsonFiles<T>(dir: string): T[] {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const filePath = path.join(dir, f);
          const stat = fs.statSync(filePath);
          if (stat.size > MetricsAggregator.MAX_FILE_SIZE) return null;
          return safeJsonParse<T>(fs.readFileSync(filePath, "utf-8"));
        } catch {
          return null;
        }
      })
      .filter((item): item is T => item !== null);
  }

  private readAuditEntries(): MetricsAuditEntry[] {
    const file = path.join(this.dojopsDir, "history", "audit.jsonl");
    if (!fs.existsSync(file)) return [];
    const lines = fs
      .readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim());
    // Cap at last N lines to prevent unbounded memory usage
    const capped = lines.slice(-MetricsAggregator.MAX_AUDIT_LINES);
    return capped
      .map((line) => {
        try {
          return safeJsonParse<MetricsAuditEntry>(line);
        } catch {
          return null;
        }
      })
      .filter((e): e is MetricsAuditEntry => e !== null);
  }

  private verifyAuditChain(entries: MetricsAuditEntry[]): {
    valid: boolean;
    errors: number;
    totalEntries: number;
    latestHash?: string;
  } {
    if (entries.length === 0) return { valid: true, errors: 0, totalEntries: 0 };

    const hmacKey = this.loadHmacKey();
    let errorCount = 0;
    let expectedPreviousHash = "genesis";
    let expectedSeq = 1;

    for (const entry of entries) {
      if (entry.seq == null || entry.hash == null) {
        errorCount++;
        continue;
      }

      if (entry.seq !== expectedSeq) errorCount++;
      if (entry.previousHash !== expectedPreviousHash) errorCount++;

      // Try HMAC first, then fall back to plain SHA-256 for legacy entries
      const recomputedHmac = hmacKey ? computeAuditHash(entry, hmacKey) : null;
      const recomputedPlain = computeAuditHash(entry, null);
      if (entry.hash !== recomputedHmac && entry.hash !== recomputedPlain) errorCount++;

      expectedPreviousHash = entry.hash;
      expectedSeq = entry.seq + 1;
    }

    const lastEntry = entries[entries.length - 1];
    return {
      valid: errorCount === 0,
      errors: errorCount,
      totalEntries: entries.length,
      latestHash: lastEntry?.hash,
    };
  }

  getOverview(): OverviewMetrics {
    if (this.cache.overview && Date.now() - this.cache.overview.ts < this.TTL) {
      return this.cache.overview.data;
    }
    const data = this.computeOverview();
    this.cache.overview = { data, ts: Date.now() };
    return data;
  }

  private computeOverview(): OverviewMetrics {
    const plans = this.readJsonFiles<PlanData>(path.join(this.dojopsDir, "plans"));
    const executions = this.readJsonFiles<ExecutionData>(
      path.join(this.dojopsDir, "execution-logs"),
    );
    const scanReports = this.readJsonFiles<ScanReport>(path.join(this.dojopsDir, "scan-history"));
    const auditEntries = this.readAuditEntries();

    const successfulExecs = executions.filter((e) => e.status === "SUCCESS").length;
    const successRate = executions.length > 0 ? (successfulExecs / executions.length) * 100 : 0;
    const avgTime =
      executions.length > 0
        ? executions.reduce((sum, e) => sum + e.durationMs, 0) / executions.length
        : 0;

    let totalFindings = 0;
    let criticalFindings = 0;
    let highFindings = 0;
    for (const report of scanReports) {
      if (report.summary) {
        totalFindings += report.summary.total;
        criticalFindings += report.summary.critical;
        highFindings += report.summary.high;
      } else if (report.findings) {
        totalFindings += report.findings.length;
        criticalFindings += report.findings.filter(
          (f) => f.severity.toUpperCase() === "CRITICAL",
        ).length;
        highFindings += report.findings.filter((f) => f.severity.toUpperCase() === "HIGH").length;
      }
    }

    // Most used agents from audit entries (prefer agent field, fall back to command verb)
    const agentCounts = new Map<string, number>();
    for (const entry of auditEntries) {
      const agent =
        ((entry as unknown as Record<string, unknown>).agent as string | undefined) ||
        entry.command?.split(/\s+/)[0] ||
        "unknown";
      agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
    }
    const mostUsedAgents = Array.from(agentCounts.entries())
      .map(([agent, count]) => ({ agent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Failure reasons from failed executions
    const reasonCounts = new Map<string, number>();
    for (const exec of executions.filter((e) => e.status === "FAILURE")) {
      const reason = `Plan ${exec.planId} failed`;
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    for (const entry of auditEntries.filter((e) => e.status === "failure")) {
      const reason = entry.action || entry.command || "unknown";
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    const failureReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Recent activity from audit entries (last 20)
    const recentActivity = auditEntries
      .slice(-20)
      .reverse()
      .map((e) => ({
        timestamp: e.timestamp,
        action: e.action,
        status: e.status,
        planId: e.planId,
      }));

    return {
      totalPlans: plans.length,
      totalExecutions: executions.length,
      successRate: Math.round(successRate * 10) / 10,
      avgExecutionTimeMs: Math.round(avgTime),
      totalScans: scanReports.length,
      totalFindings,
      criticalFindings,
      highFindings,
      mostUsedAgents,
      failureReasons,
      recentActivity,
    };
  }

  getSecurity(): SecurityMetrics {
    if (this.cache.security && Date.now() - this.cache.security.ts < this.TTL) {
      return this.cache.security.data;
    }
    const data = this.computeSecurity();
    this.cache.security = { data, ts: Date.now() };
    return data;
  }

  private computeSecurity(): SecurityMetrics {
    const scanReports = this.readJsonFiles<ScanReport>(path.join(this.dojopsDir, "scan-history"));

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    const byCategory = { security: 0, dependency: 0, iac: 0, secrets: 0 };
    const issueCounts = new Map<string, { severity: string; count: number; tool: string }>();

    for (const report of scanReports) {
      const findings = report.findings || [];
      for (const f of findings) {
        const sev = f.severity.toLowerCase() as keyof typeof bySeverity;
        if (sev in bySeverity) bySeverity[sev]++;

        const cat = (f.category || "security").toLowerCase() as keyof typeof byCategory;
        if (cat in byCategory) byCategory[cat]++;

        const key = f.message;
        const existing = issueCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          issueCounts.set(key, { severity: f.severity, count: 1, tool: f.tool });
        }
      }
    }

    const totalFindings =
      bySeverity.critical + bySeverity.high + bySeverity.medium + bySeverity.low;

    const topIssues = Array.from(issueCounts.entries())
      .map(([message, data]) => ({ message, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, MetricsAggregator.MAX_TOP_ISSUES);

    // Findings trend: group by date
    const dateMap = new Map<
      string,
      { critical: number; high: number; medium: number; low: number }
    >();
    for (const report of scanReports) {
      const date = report.timestamp ? report.timestamp.slice(0, 10) : "unknown";
      if (!dateMap.has(date)) {
        dateMap.set(date, { critical: 0, high: 0, medium: 0, low: 0 });
      }
      const bucket = dateMap.get(date)!;
      for (const f of report.findings || []) {
        const sev = f.severity.toLowerCase() as keyof typeof bucket;
        if (sev in bucket) bucket[sev]++;
      }
    }
    const findingsTrend = Array.from(dateMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    // Scan history
    const scanHistory = scanReports
      .sort((a, b) => {
        const ta = new Date(a.timestamp).getTime();
        const tb = new Date(b.timestamp).getTime();
        return tb - ta;
      })
      .map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        total: r.summary?.total ?? r.findings?.length ?? 0,
        critical:
          r.summary?.critical ??
          r.findings?.filter((f) => f.severity.toUpperCase() === "CRITICAL").length ??
          0,
        high:
          r.summary?.high ??
          r.findings?.filter((f) => f.severity.toUpperCase() === "HIGH").length ??
          0,
        durationMs: r.durationMs ?? 0,
      }));

    return {
      totalScans: scanReports.length,
      totalFindings,
      bySeverity,
      byCategory,
      findingsTrend,
      topIssues,
      scanHistory,
    };
  }

  getAudit(): AuditMetrics {
    if (this.cache.audit && Date.now() - this.cache.audit.ts < this.TTL) {
      return this.cache.audit.data;
    }
    const data = this.computeAudit();
    this.cache.audit = { data, ts: Date.now() };
    return data;
  }

  private computeAudit(): AuditMetrics {
    const entries = this.readAuditEntries();
    const chainIntegrity = this.verifyAuditChain(entries);

    const byStatus = { success: 0, failure: 0, cancelled: 0 };
    const commandCounts = new Map<string, number>();

    for (const entry of entries) {
      const status = entry.status as keyof typeof byStatus;
      if (status in byStatus) byStatus[status]++;

      const cmd = entry.command || "unknown";
      commandCounts.set(cmd, (commandCounts.get(cmd) || 0) + 1);
    }

    const byCommand = Array.from(commandCounts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count);

    const timeline = entries
      .slice(-50)
      .reverse()
      .map((e) => ({
        timestamp: e.timestamp,
        command: e.command,
        action: e.action,
        status: e.status,
        planId: e.planId,
      }));

    const recentEntries = entries.slice(-50).reverse();

    return {
      totalEntries: entries.length,
      chainIntegrity,
      byStatus,
      byCommand,
      timeline,
      recentEntries,
    };
  }

  getAll(): DashboardMetrics {
    return {
      overview: this.getOverview(),
      security: this.getSecurity(),
      audit: this.getAudit(),
      generatedAt: new Date().toISOString(),
    };
  }
}
