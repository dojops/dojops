import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
  }>;
  results?: Array<{ taskId: string; status: string; output?: unknown }>;
  files: string[];
  approvalStatus: "PENDING" | "APPROVED" | "DENIED" | "APPLIED";
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
}

// ── Project root detection ─────────────────────────────────────────

export function findProjectRoot(from?: string): string | null {
  let dir = from ?? process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, ".oda"))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

export function odaDir(rootDir: string): string {
  return path.join(rootDir, ".oda");
}

// ── Init ───────────────────────────────────────────────────────────

export function initProject(rootDir: string): string[] {
  const base = odaDir(rootDir);
  const dirs = [
    base,
    path.join(base, "plans"),
    path.join(base, "history"),
    path.join(base, "execution-logs"),
    path.join(base, "approvals"),
    path.join(base, "artifacts"),
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
    created.push(".oda/session.json");
  }

  // Init .gitignore for .oda/
  const gitignore = path.join(base, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, "# ODA project state\nsession.json\nexecution-logs/\napprovals/\n");
    created.push(".oda/.gitignore");
  }

  return created;
}

// ── Session ────────────────────────────────────────────────────────

export function loadSession(rootDir: string): SessionState {
  const file = path.join(odaDir(rootDir), "session.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as SessionState;
  } catch {
    return { mode: "IDLE", updatedAt: new Date().toISOString() };
  }
}

export function saveSession(rootDir: string, session: SessionState): void {
  const file = path.join(odaDir(rootDir), "session.json");
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(session, null, 2) + "\n");
}

// ── Plans ──────────────────────────────────────────────────────────

function plansDir(rootDir: string): string {
  return path.join(odaDir(rootDir), "plans");
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

export function loadPlan(rootDir: string, planId: string): PlanState | null {
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
  return path.join(odaDir(rootDir), "execution-logs");
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
  return path.join(odaDir(rootDir), "history", "audit.jsonl");
}

export function appendAudit(rootDir: string, entry: AuditEntry): void {
  const file = auditFile(rootDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
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
