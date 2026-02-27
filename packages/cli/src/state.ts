import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { RepoContextSchemaV1, RepoContextSchemaV2 } from "@dojops/core";
import type { RepoContext } from "@dojops/core";

// ── Types ──────────────────────────────────────────────────────────

export interface SessionState {
  currentPlan?: string;
  mode: "IDLE" | "PLAN" | "APPLY";
  lastAgent?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  updatedAt: string;
}

export interface PlanState {
  id: string;
  goal: string;
  createdAt: string;
  risk: string;
  tasks: Array<{
    id: string;
    tool: string;
    description: string;
    dependsOn: string[];
    input?: Record<string, unknown>;
    toolType?: "built-in" | "custom";
    toolVersion?: string;
    toolHash?: string;
    toolSource?: "global" | "project";
    systemPromptHash?: string;
  }>;
  results?: Array<{
    taskId: string;
    status: string;
    output?: unknown;
    error?: string;
    filesCreated?: string[];
    executionStatus?: string;
    executionApproval?: string;
  }>;
  files: string[];
  approvalStatus: "PENDING" | "APPROVED" | "DENIED" | "APPLIED" | "PARTIAL";
  executionContext?: {
    provider: string;
    model?: string;
    temperature?: number;
    dojopsVersion?: string;
    policySnapshot?: string;
    toolVersions?: Record<string, string>;
  };
}

export interface ExecutionRecord {
  planId: string;
  executedAt: string;
  status: "SUCCESS" | "FAILURE" | "PARTIAL";
  filesCreated: string[];
  filesModified: string[];
  durationMs: number;
}

export interface AuditEntry {
  timestamp: string;
  user: string;
  command: string;
  action: string;
  planId?: string;
  status: "success" | "failure" | "cancelled";
  durationMs: number;
  seq?: number;
  hash?: string;
  previousHash?: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  totalEntries: number;
  errors: Array<{ seq: number; line: number; reason: string }>;
}

export interface LockInfo {
  pid: number;
  operation: string;
  acquiredAt: string;
}

// ── Execution locking ─────────────────────────────────────────────

export function acquireLock(rootDir: string, operation: string): boolean {
  const lockFile = path.join(dojopsDir(rootDir), "lock.json");
  const info: LockInfo = {
    pid: process.pid,
    operation,
    acquiredAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(lockFile, JSON.stringify(info, null, 2) + "\n", {
      flag: "wx",
    });
    return true;
  } catch {
    // File already exists — check if stale
    const status = isLocked(rootDir);
    if (!status.locked) {
      // Stale lock was cleaned up, retry
      try {
        fs.writeFileSync(lockFile, JSON.stringify(info, null, 2) + "\n", {
          flag: "wx",
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function releaseLock(rootDir: string): void {
  const lockFile = path.join(dojopsDir(rootDir), "lock.json");
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // Already removed — no-op
  }
}

export function isLocked(rootDir: string): { locked: boolean; info?: LockInfo } {
  const lockFile = path.join(dojopsDir(rootDir), "lock.json");
  try {
    const data = JSON.parse(fs.readFileSync(lockFile, "utf-8")) as LockInfo;
    // Check if the locking process is still alive
    try {
      process.kill(data.pid, 0);
      return { locked: true, info: data };
    } catch {
      // Process is dead — stale lock, clean up
      fs.unlinkSync(lockFile);
      return { locked: false };
    }
  } catch {
    return { locked: false };
  }
}

// ── Project root detection ─────────────────────────────────────────

export function findProjectRoot(from?: string): string | null {
  let dir = from ?? process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".dojops"))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

export function dojopsDir(rootDir: string): string {
  return path.join(rootDir, ".dojops");
}

// ── Init ───────────────────────────────────────────────────────────

export function initProject(rootDir: string): string[] {
  const base = dojopsDir(rootDir);
  const dirs = [
    base,
    path.join(base, "plans"),
    path.join(base, "history"),
    path.join(base, "execution-logs"),
    path.join(base, "approvals"),
    path.join(base, "artifacts"),
    path.join(base, "sessions"),
    path.join(base, "sbom"),
  ];

  const created: string[] = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(path.relative(rootDir, d));
    }
  }

  // Init session file
  const sessionFile = path.join(base, "session.json");
  if (!fs.existsSync(sessionFile)) {
    const session: SessionState = {
      mode: "IDLE",
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2) + "\n");
    created.push(".dojops/session.json");
  }

  // Init .gitignore for .dojops/
  const gitignore = path.join(base, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(
      gitignore,
      "# DojOps project state\nsession.json\nexecution-logs/\napprovals/\nsessions/\n",
    );
    created.push(".dojops/.gitignore");
  }

  // Copy DojOps icon into .dojops/
  const iconTarget = path.join(base, "dojops-icon.png");
  if (!fs.existsSync(iconTarget)) {
    const iconSource = path.join(__dirname, "..", "assets", "dojops-icon.png");
    if (fs.existsSync(iconSource)) {
      fs.copyFileSync(iconSource, iconTarget);
      created.push(".dojops/dojops-icon.png");
    }
  }

  return created;
}

// ── Session ────────────────────────────────────────────────────────

export function loadSession(rootDir: string): SessionState {
  const file = path.join(dojopsDir(rootDir), "session.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as SessionState;
  } catch {
    return { mode: "IDLE", updatedAt: new Date().toISOString() };
  }
}

export function saveSession(rootDir: string, session: SessionState): void {
  const file = path.join(dojopsDir(rootDir), "session.json");
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(session, null, 2) + "\n");
}

// ── Plans ──────────────────────────────────────────────────────────

function plansDir(rootDir: string): string {
  return path.join(dojopsDir(rootDir), "plans");
}

export function generatePlanId(): string {
  return `plan-${crypto.randomUUID().slice(0, 8)}`;
}

export function savePlan(rootDir: string, plan: PlanState): string {
  const dir = plansDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${plan.id}.json`);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + "\n");
  return plan.id;
}

export function isValidPlanId(planId: string): boolean {
  return /^plan-[a-z0-9-]+$/.test(planId);
}

export function loadPlan(rootDir: string, planId: string): PlanState | null {
  if (!isValidPlanId(planId)) return null;
  const file = path.join(plansDir(rootDir), `${planId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as PlanState;
  } catch {
    return null;
  }
}

export function listPlans(rootDir: string): PlanState[] {
  const dir = plansDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as PlanState;
      } catch {
        return null;
      }
    })
    .filter((p): p is PlanState => p !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getLatestPlan(rootDir: string): PlanState | null {
  const plans = listPlans(rootDir);
  return plans.length > 0 ? plans[0] : null;
}

// ── Execution logs ─────────────────────────────────────────────────

function execLogsDir(rootDir: string): string {
  return path.join(dojopsDir(rootDir), "execution-logs");
}

export function saveExecution(rootDir: string, record: ExecutionRecord): void {
  const dir = execLogsDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.planId}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
}

export function listExecutions(rootDir: string): ExecutionRecord[] {
  const dir = execLogsDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ExecutionRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is ExecutionRecord => r !== null)
    .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());
}

// ── Audit ──────────────────────────────────────────────────────────

function auditFile(rootDir: string): string {
  return path.join(dojopsDir(rootDir), "history", "audit.jsonl");
}

function computeAuditHash(entry: AuditEntry): string {
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
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function acquireAuditLock(lockPath: string, maxRetries = 5, delayMs = 50): number {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return fs.openSync(lockPath, "wx");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EEXIST") {
        // Lock held by another process — check if stale (> 10s)
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 10_000) {
            // Stale lock — remove and retry
            try {
              fs.unlinkSync(lockPath);
            } catch {
              // Another process may have already cleaned it up
            }
            continue;
          }
        } catch {
          // stat failed — file may already be gone, retry
          continue;
        }
        // Active lock — wait and retry
        const waitUntil = Date.now() + delayMs * Math.pow(2, attempt);
        while (Date.now() < waitUntil) {
          /* busy-wait */
        }
        continue;
      }
      throw err;
    }
  }
  return -1;
}

export function appendAudit(rootDir: string, entry: AuditEntry): void {
  const file = auditFile(rootDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lockPath = file + ".lock";
  const lockFd = acquireAuditLock(lockPath);

  try {
    let previousHash = "genesis";
    let seq = 1;

    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf-8").trimEnd();
      if (content.length > 0) {
        const lines = content.split("\n");
        const lastLine = lines[lines.length - 1];
        try {
          const lastEntry = JSON.parse(lastLine) as AuditEntry;
          previousHash = lastEntry.hash ?? "genesis";
          seq = (lastEntry.seq ?? 0) + 1;
        } catch {
          // Corrupt last line — reset chain
        }
      }
    }

    entry.seq = seq;
    entry.previousHash = previousHash;
    entry.hash = computeAuditHash(entry);

    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } finally {
    if (lockFd >= 0) {
      try {
        fs.closeSync(lockFd);
      } catch {
        // ignore
      }
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Already removed — no-op
    }
  }
}

export function readAudit(
  rootDir: string,
  filters?: { planId?: string; status?: string },
): AuditEntry[] {
  const file = auditFile(rootDir);
  if (!fs.existsSync(file)) return [];

  const entries = fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line) as AuditEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditEntry => e !== null);

  if (!filters) return entries;

  return entries.filter((e) => {
    if (filters.planId && e.planId !== filters.planId) return false;
    if (filters.status && e.status !== filters.status) return false;
    return true;
  });
}

export function verifyAuditIntegrity(rootDir: string): AuditVerificationResult {
  const file = auditFile(rootDir);
  if (!fs.existsSync(file)) return { valid: true, totalEntries: 0, errors: [] };

  const content = fs.readFileSync(file, "utf-8").trimEnd();
  if (content.length === 0) return { valid: true, totalEntries: 0, errors: [] };

  const lines = content.split("\n");
  const errors: AuditVerificationResult["errors"] = [];
  let expectedPreviousHash = "genesis";
  let expectedSeq = 1;

  for (let i = 0; i < lines.length; i++) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(lines[i]) as AuditEntry;
    } catch {
      errors.push({ seq: expectedSeq, line: i + 1, reason: "Invalid JSON" });
      expectedPreviousHash = "genesis";
      expectedSeq++;
      continue;
    }

    // Legacy entry without hash fields — skip gracefully, reset chain
    if (entry.seq == null || entry.hash == null) {
      expectedPreviousHash = "genesis";
      expectedSeq = 1;
      continue;
    }

    if (entry.seq !== expectedSeq) {
      errors.push({
        seq: entry.seq ?? expectedSeq,
        line: i + 1,
        reason: `Expected seq ${expectedSeq}, got ${entry.seq}`,
      });
    }

    if (entry.previousHash !== expectedPreviousHash) {
      errors.push({
        seq: entry.seq ?? expectedSeq,
        line: i + 1,
        reason: `Previous hash mismatch`,
      });
    }

    const recomputed = computeAuditHash(entry);
    if (entry.hash !== recomputed) {
      errors.push({
        seq: entry.seq ?? expectedSeq,
        line: i + 1,
        reason: `Hash mismatch (tampered)`,
      });
    }

    expectedPreviousHash = entry.hash;
    expectedSeq = entry.seq + 1;
  }

  return { valid: errors.length === 0, totalEntries: lines.length, errors };
}

// ── Scan history ──────────────────────────────────────────────────

function scanHistoryDir(rootDir: string): string {
  return path.join(dojopsDir(rootDir), "scan-history");
}

export function saveScanReport(rootDir: string, report: Record<string, unknown>): void {
  const dir = scanHistoryDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const id = (report.id as string) ?? `scan-${Date.now()}`;
  const file = path.join(dir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
}

export function loadScanReport(rootDir: string, scanId: string): Record<string, unknown> | null {
  const file = path.join(scanHistoryDir(rootDir), `${scanId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function listScanReports(rootDir: string): Array<Record<string, unknown>> {
  const dir = scanHistoryDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r !== null)
    .sort((a, b) => {
      const ta = new Date(a.timestamp as string).getTime();
      const tb = new Date(b.timestamp as string).getTime();
      return tb - ta;
    });
}

// ── Git status ────────────────────────────────────────────────────

export function checkGitDirty(cwd: string): { dirty: boolean; files: string[] } {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const files = output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return { dirty: files.length > 0, files };
  } catch {
    // Not a git repo or git not available — skip check
    return { dirty: false, files: [] };
  }
}

// ── Package version ───────────────────────────────────────────────

export function getDojopsVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Repo context ──────────────────────────────────────────────────

export function loadContext(rootDir: string): RepoContext | null {
  const file = path.join(dojopsDir(rootDir), "context.json");
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));

    // Try V2 first
    const v2 = RepoContextSchemaV2.safeParse(data);
    if (v2.success) return v2.data;

    // Fall back to V1 and migrate
    const v1 = RepoContextSchemaV1.safeParse(data);
    if (v1.success) {
      const migrated: RepoContext = {
        ...v1.data,
        version: 2,
        infra: {
          ...v1.data.infra,
          hasKustomize: false,
          hasVagrant: false,
          hasPulumi: false,
          hasCloudFormation: false,
        },
        monitoring: {
          ...v1.data.monitoring,
          hasHaproxy: false,
          hasTomcat: false,
          hasApache: false,
          hasCaddy: false,
          hasEnvoy: false,
        },
        scripts: { shellScripts: [], pythonScripts: [], hasJustfile: false },
        security: {
          hasEnvExample: false,
          hasGitignore: false,
          hasCodeowners: false,
          hasSecurityPolicy: false,
          hasDependabot: false,
          hasRenovate: false,
          hasSecretScanning: false,
          hasEditorConfig: false,
        },
        devopsFiles: [],
      };
      return migrated;
    }

    return null;
  } catch {
    return null;
  }
}
