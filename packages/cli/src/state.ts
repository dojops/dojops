import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runBin } from "@dojops/sdk";
import { writeFileOwnerOnly } from "./secure-fs";
import { encrypt as vaultEncrypt, decrypt as vaultDecrypt, isEncrypted } from "./vault";
import { RepoContextSchemaV1, RepoContextSchemaV2, parseDojopsMdString } from "@dojops/core";
import type { RepoContext } from "@dojops/core";

// ── User identity ─────────────────────────────────────────────────

/**
 * Returns the current OS username via os.userInfo() instead of the
 * trivially-spoofable process.env.USER / process.env.USERNAME.
 * Falls back to "unknown" if os.userInfo() throws (e.g. missing /etc/passwd entry).
 */
export function getCurrentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
}

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
  status: "success" | "failure" | "cancelled" | "drift-detected" | "no-drift";
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
  uuid: string;
  operation: string;
  acquiredAt: string;
}

/** Maximum lock age before it is considered stale, regardless of PID liveness (2 hours). */
const MAX_LOCK_AGE_MS = 2 * 60 * 60 * 1000;

// ── Execution locking ─────────────────────────────────────────────

// NOTE: There is a small TOCTOU window between stale lock removal and
// retry write. Another process could acquire the lock in this window.
// This is an inherent limitation of file-based locking. For production
// multi-process deployments, consider using a proper distributed lock.
export function acquireLock(rootDir: string, operation: string): boolean {
  const lockFile = path.join(dojopsDir(rootDir), "lock.json");
  const info: LockInfo = {
    pid: process.pid,
    uuid: crypto.randomUUID(),
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

    // H-7: Check lock age first — if older than MAX_LOCK_AGE_MS, treat as stale
    // regardless of PID liveness (guards against PID reuse attacks)
    const lockAge = Date.now() - new Date(data.acquiredAt).getTime();
    if (lockAge > MAX_LOCK_AGE_MS) {
      fs.unlinkSync(lockFile);
      return { locked: false };
    }

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
    path.join(base, "memory"),
    path.join(base, "debug"),
    path.join(base, "checkpoints"),
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

  // Init HMAC key for audit hash chain (A5)
  createAuditKey(rootDir);

  // Init .gitignore for .dojops/
  const gitignore = path.join(base, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(
      gitignore,
      "# DojOps project state\nsession.json\nexecution-logs/\napprovals/\nsessions/\nmemory/\naudit-key\ncheckpoints/\n",
    );
    created.push(".dojops/.gitignore");
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

// ── Last Generation (cross-command memory) ─────────────────────────

export interface LastGeneration {
  timestamp: string;
  prompt: string;
  skillName?: string;
  agentName?: string;
  content: string;
  filesWritten: string[];
  contentHash: string;
}

const MAX_LAST_GEN_SIZE = 100 * 1024; // 100 KB cap

export function saveLastGeneration(rootDir: string, gen: LastGeneration): void {
  if (gen.content.length > MAX_LAST_GEN_SIZE) return; // skip if too large
  const base = dojopsDir(rootDir);
  if (!fs.existsSync(base)) return;
  const file = path.join(base, "last-generation.json");
  fs.writeFileSync(file, JSON.stringify(gen, null, 2) + "\n");

  // Ensure .gitignore has this entry
  const gitignore = path.join(base, ".gitignore");
  try {
    const content = fs.readFileSync(gitignore, "utf-8");
    if (!content.includes("last-generation.json")) {
      fs.writeFileSync(gitignore, content.trimEnd() + "\nlast-generation.json\n");
    }
  } catch {
    // .gitignore doesn't exist yet — will be created at next init
  }
}

export function loadLastGeneration(rootDir: string): LastGeneration | null {
  const file = path.join(dojopsDir(rootDir), "last-generation.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as LastGeneration;
  } catch {
    return null;
  }
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
  // A14: Atomic write to prevent corruption on concurrent access
  const content = JSON.stringify(plan, null, 2) + "\n";
  const tmpFile = `${file}.tmp`;
  try {
    fs.writeFileSync(tmpFile, content);
    fs.renameSync(tmpFile, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* .tmp already gone */
    }
    throw err;
  }
  return plan.id;
}

export function isValidPlanId(planId: string): boolean {
  return /^plan-[a-z0-9-]+$/.test(planId);
}

const VALID_RISK_LEVELS = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const VALID_APPROVAL_STATUSES = new Set(["PENDING", "APPROVED", "DENIED", "APPLIED", "PARTIAL"]);

/**
 * H-9: Validates plan data after JSON.parse to prevent malicious plan files
 * from bypassing security gates (e.g., spoofing risk level).
 * Throws if critical fields have unexpected types or values.
 */
function validatePlanData(data: unknown): PlanState {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Plan data must be a non-null object");
  }

  const plan = data as Record<string, unknown>;

  if (typeof plan.id !== "string" || !plan.id) {
    throw new Error("Plan must have a string 'id'");
  }
  if (typeof plan.goal !== "string") {
    throw new TypeError("Plan must have a string 'goal'");
  }
  if (typeof plan.createdAt !== "string") {
    throw new TypeError("Plan must have a string 'createdAt'");
  }
  if (typeof plan.risk !== "string" || !VALID_RISK_LEVELS.has(plan.risk)) {
    throw new TypeError(
      `Plan 'risk' must be one of ${[...VALID_RISK_LEVELS].join(", ")}, got: ${String(plan.risk)}`,
    );
  }
  if (!Array.isArray(plan.tasks)) {
    throw new TypeError("Plan must have an array 'tasks'");
  }
  for (const task of plan.tasks) {
    if (typeof task !== "object" || task === null) {
      throw new TypeError("Each task must be a non-null object");
    }
    if (typeof task.id !== "string" || typeof task.tool !== "string") {
      throw new TypeError("Each task must have string 'id' and 'tool'");
    }
  }
  if (!Array.isArray(plan.files)) {
    throw new TypeError("Plan must have an array 'files'");
  }
  if (
    typeof plan.approvalStatus !== "string" ||
    !VALID_APPROVAL_STATUSES.has(plan.approvalStatus)
  ) {
    throw new Error(
      `Plan 'approvalStatus' must be one of ${[...VALID_APPROVAL_STATUSES].join(", ")}, got: ${String(plan.approvalStatus)}`,
    );
  }

  return data as PlanState;
}

export function loadPlan(rootDir: string, planId: string): PlanState | null {
  if (!isValidPlanId(planId)) return null;
  const file = path.join(plansDir(rootDir), `${planId}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return validatePlanData(data);
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
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        return validatePlanData(data);
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

export function auditFile(rootDir: string): string {
  return path.join(dojopsDir(rootDir), "history", "audit.jsonl");
}

/**
 * Load the HMAC key for audit hash chain.
 * G-46: If the vault is available, the key is stored encrypted.
 * Backward compatible: reads unencrypted keys and re-encrypts on next write.
 */
export function loadAuditKey(rootDir: string): string | null {
  const keyFile = path.join(dojopsDir(rootDir), "audit-key");
  try {
    const raw = fs.readFileSync(keyFile, "utf-8").trim();
    if (isEncrypted(raw)) {
      try {
        const decrypted = vaultDecrypt(raw);
        return decrypted;
      } catch {
        console.warn("[audit] Failed to decrypt audit key — vault key mismatch?");
        return null;
      }
    }
    // Plaintext key found — re-encrypt on next write for migration
    try {
      const encrypted = vaultEncrypt(raw);
      writeFileOwnerOnly(keyFile, encrypted + "\n");
    } catch {
      // Vault not initialized yet — keep plaintext, warn
      console.warn("[audit] Audit key stored as plaintext. Run `dojops init` to encrypt.");
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Create a new HMAC key for audit hash chain (called during init).
 * G-46: Encrypts the key using the vault if available.
 */
export function createAuditKey(rootDir: string): void {
  const keyFile = path.join(dojopsDir(rootDir), "audit-key");
  if (fs.existsSync(keyFile)) return;
  const key = crypto.randomBytes(32).toString("hex");
  try {
    const encrypted = vaultEncrypt(key);
    writeFileOwnerOnly(keyFile, encrypted + "\n");
  } catch {
    // Vault not available — store plaintext with restricted permissions
    console.warn("[audit] Vault unavailable — storing audit key as plaintext.");
    writeFileOwnerOnly(keyFile, key + "\n");
  }
}

export function computeAuditHash(entry: AuditEntry, hmacKey?: string | null): string {
  // Use null byte delimiter to avoid field value collisions
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
  // Legacy fallback: plain SHA-256
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/** Try to remove a stale lock file. Returns true if removed or already gone. */
function tryRemoveStaleLock(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs <= 10_000) return false; // Active lock
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* already cleaned */
    }
    return true;
  } catch {
    return true; // stat failed — file gone, treat as removed
  }
}

async function acquireAuditLock(lockPath: string, maxRetries = 5, delayMs = 50): Promise<number> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return fs.openSync(lockPath, "wx");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;

      if (tryRemoveStaleLock(lockPath)) continue;

      // Active lock — async wait with exponential backoff (non-blocking)
      const waitMs = delayMs * Math.pow(2, attempt);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return -1;
}

// ── E-5: Audit log rotation ──────────────────────────────────────

const DEFAULT_AUDIT_MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Rotate the audit log if it exceeds the configured max size.
 * Renames audit.jsonl -> audit.jsonl.1 (overwrites existing .1) and starts fresh.
 */
/**
 * Rotate the audit log if it exceeds the configured max size.
 * Preserves hash chain continuity by recording the last hash from the
 * rotated file as the genesis link in the new chain.
 * Returns the last hash from the rotated chain (or null if no rotation occurred).
 */
function rotateAuditIfNeeded(file: string): string | null {
  const maxSizeEnv = process.env.DOJOPS_AUDIT_MAX_SIZE_MB;
  const maxBytes = maxSizeEnv
    ? Number.parseFloat(maxSizeEnv) * 1024 * 1024
    : DEFAULT_AUDIT_MAX_SIZE_BYTES;

  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return null;

  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) {
      // Read the last entry's hash before rotating, to link chains
      let lastHash = "genesis";
      try {
        const content = fs.readFileSync(file, "utf-8").trimEnd();
        const lines = content.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.hash) {
              lastHash = entry.hash;
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // Could not read last hash — use genesis
      }

      const rotated = file + ".1";
      fs.renameSync(file, rotated);
      return lastHash;
    }
  } catch {
    // File doesn't exist yet or stat failed — nothing to rotate
  }
  return null;
}

function findLastValidAuditEntry(file: string): AuditEntry | null {
  const content = fs.readFileSync(file, "utf-8").trimEnd();
  if (content.length === 0) return null;
  const lines = content.split("\n");
  for (let j = lines.length - 1; j >= 0; j--) {
    try {
      return JSON.parse(lines[j]) as AuditEntry;
    } catch {
      if (j === lines.length - 1) {
        console.warn("[audit] Last audit entry is corrupt — scanning for last valid entry");
      }
    }
  }
  return null;
}

export async function appendAudit(rootDir: string, entry: AuditEntry): Promise<void> {
  const file = auditFile(rootDir);
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // E-5: Rotate before appending if file exceeds size limit.
  // Returns the last hash from the rotated chain to preserve chain continuity.
  const rotatedLastHash = rotateAuditIfNeeded(file);

  // A5: Load HMAC key for audit hash chain
  const hmacKey = loadAuditKey(rootDir);
  if (!hmacKey) {
    console.warn(
      "[audit] No HMAC key found (.dojops/audit-key). Using legacy SHA-256 hashing. Run `dojops init` to create one.",
    );
  }

  const lockPath = file + ".lock";
  const lockFd = await acquireAuditLock(lockPath);

  // If lock acquisition failed, skip the write to avoid chain corruption
  if (lockFd < 0) {
    console.warn(
      "[audit] Failed to acquire audit lock — skipping audit entry to protect chain integrity",
    );
    return;
  }

  try {
    // If rotation just occurred, use the last hash from the rotated chain as genesis link
    let previousHash = rotatedLastHash ?? "genesis";
    let seq = 1;

    if (fs.existsSync(file)) {
      const chainTip = findLastValidAuditEntry(file);
      if (chainTip) {
        previousHash = chainTip.hash ?? "genesis";
        seq = (chainTip.seq ?? 0) + 1;
      }
    }

    entry.seq = seq;
    entry.previousHash = previousHash;
    entry.hash = computeAuditHash(entry, hmacKey);

    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } finally {
    if (lockFd >= 0) {
      try {
        fs.closeSync(lockFd);
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Already removed — no-op
      }
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

function verifyAuditEntry(
  entry: AuditEntry,
  expectedSeq: number,
  expectedPreviousHash: string,
  hmacKey: string | null,
  lineNum: number,
  errors: AuditVerificationResult["errors"],
): void {
  if (entry.seq !== expectedSeq) {
    errors.push({
      seq: entry.seq ?? expectedSeq,
      line: lineNum,
      reason: `Expected seq ${expectedSeq}, got ${entry.seq}`,
    });
  }

  if (entry.previousHash !== expectedPreviousHash) {
    errors.push({
      seq: entry.seq ?? expectedSeq,
      line: lineNum,
      reason: `Previous hash mismatch`,
    });
  }

  const recomputedHmac = hmacKey ? computeAuditHash(entry, hmacKey) : null;
  const recomputedPlain = computeAuditHash(entry, null);
  if (entry.hash !== recomputedHmac && entry.hash !== recomputedPlain) {
    errors.push({
      seq: entry.seq ?? expectedSeq,
      line: lineNum,
      reason: `Hash mismatch (tampered)`,
    });
  }
}

export function verifyAuditIntegrity(rootDir: string): AuditVerificationResult {
  const file = auditFile(rootDir);
  if (!fs.existsSync(file)) return { valid: true, totalEntries: 0, errors: [] };

  const content = fs.readFileSync(file, "utf-8").trimEnd();
  if (content.length === 0) return { valid: true, totalEntries: 0, errors: [] };

  const hmacKey = loadAuditKey(rootDir);
  const lines = content.split("\n");
  const errors: AuditVerificationResult["errors"] = [];
  let expectedPreviousHash = "genesis";
  let expectedSeq = 1;
  let chainStarted = false;

  for (let i = 0; i < lines.length; i++) {
    let entry: AuditEntry;
    try {
      entry = JSON.parse(lines[i]) as AuditEntry;
    } catch {
      errors.push({ seq: expectedSeq, line: i + 1, reason: "Invalid JSON" });
      expectedSeq++;
      continue;
    }

    if (entry.seq == null || entry.hash == null) {
      if (chainStarted) {
        errors.push({
          seq: expectedSeq,
          line: i + 1,
          reason: "Hash fields missing in chained entry",
        });
      }
      continue;
    }
    chainStarted = true;

    verifyAuditEntry(entry, expectedSeq, expectedPreviousHash, hmacKey, i + 1, errors);

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

export function isValidScanId(scanId: string): boolean {
  return /^scan-[a-z0-9-]+$/.test(scanId);
}

export function loadScanReport(rootDir: string, scanId: string): Record<string, unknown> | null {
  if (!isValidScanId(scanId)) return null;
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
    const output = runBin("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 5_000,
      stdio: ["pipe", "pipe", "pipe"],
    }) as string;
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
  // Try DOJOPS.md first (new unified format)
  try {
    const mdPath = path.join(rootDir, "DOJOPS.md");
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, "utf-8");
      const { context } = parseDojopsMdString(content, rootDir);
      if (context) return context;
    }
  } catch {
    // Fall through to legacy JSON
  }

  // Legacy: .dojops/context.json
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

// ── Debug output tee/recovery ──────────────────────────────────────

/**
 * Save raw tool output to .dojops/debug/ for later reference.
 * Used when compression loses detail or when tools fail.
 * Returns the path to the saved file.
 */
export function saveDebugOutput(
  rootDir: string,
  source: string,
  content: string,
  metadata?: Record<string, unknown>,
): string {
  const debugDir = path.join(dojopsDir(rootDir), "debug");
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const ts = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const safeName = source.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(debugDir, `${safeName}-${ts}.txt`);

  const header = metadata
    ? `--- debug output ---\nsource: ${source}\ntimestamp: ${new Date().toISOString()}\n${Object.entries(
        metadata,
      )
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}\n---\n\n`
    : "";

  fs.writeFileSync(filePath, header + content);
  return filePath;
}

/**
 * List debug output files, newest first.
 */
export function listDebugOutputs(rootDir: string): string[] {
  const debugDir = path.join(dojopsDir(rootDir), "debug");
  if (!fs.existsSync(debugDir)) return [];
  return fs
    .readdirSync(debugDir)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .reverse()
    .map((f) => path.join(debugDir, f));
}

/**
 * Read the most recent debug output for a given source.
 */
export function readLatestDebugOutput(rootDir: string, source: string): string | null {
  const debugDir = path.join(dojopsDir(rootDir), "debug");
  if (!fs.existsSync(debugDir)) return null;
  const safeName = source.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const files = fs
    .readdirSync(debugDir)
    .filter((f) => f.startsWith(safeName) && f.endsWith(".txt"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  return fs.readFileSync(path.join(debugDir, files[0]), "utf-8");
}
