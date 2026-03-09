import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────────────

export type TaskType = "generate" | "plan" | "apply" | "scan" | "init" | "chat";
export type TaskStatus = "success" | "failure" | "cancelled";

export interface TaskRecord {
  id: number;
  timestamp: string;
  task_type: TaskType;
  prompt: string;
  result_summary: string;
  status: TaskStatus;
  duration_ms: number;
  related_files: string;
  agent_or_module: string;
  metadata: string;
}

export interface MemoryContext {
  recentTasks: TaskRecord[];
  relatedTasks: TaskRecord[];
  isContinuation: boolean;
  continuationOf?: TaskRecord;
}

// ── Constants ──────────────────────────────────────────────────────

const MEMORY_DIR = "memory";
const DB_FILENAME = "dojops.db";
const MAX_RECENT = 10;
const MAX_RELATED = 5;
const MAX_CONTEXT_CHARS = 1200;
/** Hours within which a similar task is considered a continuation. */
const CONTINUATION_WINDOW_HOURS = 24;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        TEXT    NOT NULL,
  task_type        TEXT    NOT NULL,
  prompt           TEXT    NOT NULL DEFAULT '',
  result_summary   TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL,
  duration_ms      INTEGER NOT NULL DEFAULT 0,
  related_files    TEXT    NOT NULL DEFAULT '[]',
  agent_or_module  TEXT    NOT NULL DEFAULT '',
  metadata         TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tasks_history_type_ts
  ON tasks_history(task_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_history_ts
  ON tasks_history(timestamp DESC);
`;

// ── Database lifecycle ─────────────────────────────────────────────

const dbCache = new Map<string, Database.Database>();

// Close all cached connections on process exit to prevent hanging
process.on("exit", () => {
  for (const db of dbCache.values()) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  dbCache.clear();
});

function memoryDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", MEMORY_DIR);
}

function dbPath(rootDir: string): string {
  return path.join(memoryDir(rootDir), DB_FILENAME);
}

/**
 * Open (or create) the memory database. Idempotent — caches per rootDir.
 * Returns null if the database cannot be opened.
 */
export function openMemoryDb(rootDir: string): Database.Database | null {
  const cached = dbCache.get(rootDir);
  if (cached) return cached;

  try {
    const dir = memoryDir(rootDir);
    fs.mkdirSync(dir, { recursive: true });

    const db = new Database(dbPath(rootDir));
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA_SQL);

    dbCache.set(rootDir, db);
    return db;
  } catch {
    return null;
  }
}

/** Close and remove a cached DB instance. Used in tests. */
export function closeMemoryDb(rootDir: string): void {
  const db = dbCache.get(rootDir);
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    dbCache.delete(rootDir);
  }
}

// ── Write ──────────────────────────────────────────────────────────

/** Record a completed task. Silent on failure — memory is non-critical. */
export function recordTask(rootDir: string, record: Omit<TaskRecord, "id">): void {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return;

    db.prepare(
      `
      INSERT INTO tasks_history
        (timestamp, task_type, prompt, result_summary, status,
         duration_ms, related_files, agent_or_module, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      record.timestamp,
      record.task_type,
      record.prompt,
      record.result_summary,
      record.status,
      record.duration_ms,
      record.related_files,
      record.agent_or_module,
      record.metadata,
    );
  } catch {
    // silent — memory is non-critical
  }
}

// ── Read ───────────────────────────────────────────────────────────

/**
 * Tokenize a prompt into lowercase words for overlap comparison.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Check if two prompts share enough words to be considered related.
 * Returns true if at least 3 of the first 8 words overlap.
 */
function promptsOverlap(a: string, b: string): boolean {
  const tokensA = new Set(tokenize(a).slice(0, 8));
  const tokensB = tokenize(b).slice(0, 8);
  if (tokensA.size === 0 || tokensB.length === 0) return false;
  let overlap = 0;
  for (const t of tokensB) {
    if (tokensA.has(t)) overlap++;
  }
  return overlap >= 3;
}

/**
 * Query memory for context about the current task.
 * Returns recent tasks + related tasks + continuation detection.
 */
export function queryMemory(rootDir: string, taskType: TaskType, prompt: string): MemoryContext {
  const empty: MemoryContext = {
    recentTasks: [],
    relatedTasks: [],
    isContinuation: false,
  };

  try {
    const db = openMemoryDb(rootDir);
    if (!db) return empty;

    // Last N tasks overall (any type)
    const recentTasks = db
      .prepare(
        `
      SELECT * FROM tasks_history
      ORDER BY timestamp DESC
      LIMIT ?
    `,
      )
      .all(MAX_RECENT) as TaskRecord[];

    // Last N tasks of the same type
    const relatedTasks = db
      .prepare(
        `
      SELECT * FROM tasks_history
      WHERE task_type = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
      )
      .all(taskType, MAX_RELATED) as TaskRecord[];

    // Continuation detection: same type, similar prompt, within time window
    let isContinuation = false;
    let continuationOf: TaskRecord | undefined;

    if (prompt) {
      const cutoff = new Date(
        Date.now() - CONTINUATION_WINDOW_HOURS * 60 * 60 * 1000,
      ).toISOString();

      const candidates = db
        .prepare(
          `
        SELECT * FROM tasks_history
        WHERE task_type = ? AND timestamp > ? AND status = 'success'
        ORDER BY timestamp DESC
        LIMIT 10
      `,
        )
        .all(taskType, cutoff) as TaskRecord[];

      for (const c of candidates) {
        if (c.prompt && promptsOverlap(prompt, c.prompt)) {
          isContinuation = true;
          continuationOf = c;
          break;
        }
      }
    }

    return { recentTasks, relatedTasks, isContinuation, continuationOf };
  } catch {
    return empty;
  }
}

// ── Context formatting ─────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

/** Summarize a task into a human-readable one-liner for the LLM. */
function summarizeTask(t: TaskRecord): string {
  const failureVerb = t.status === "failure" ? "Failed" : "Cancelled";
  const verb = t.status === "success" ? "Completed" : failureVerb;
  const module = t.agent_or_module ? ` via ${t.agent_or_module}` : "";
  const prompt = t.prompt ? truncate(t.prompt, 80) : t.task_type;

  // Use result_summary if available, otherwise fall back to prompt
  if (t.result_summary && t.result_summary.length > 5) {
    return `${verb}: ${truncate(t.result_summary, 100)}${module}`;
  }
  return `${verb}: ${prompt}${module}`;
}

/** Extract file paths from related_files JSON string. */
function extractFiles(t: TaskRecord): string[] {
  try {
    const files = JSON.parse(t.related_files);
    return Array.isArray(files) ? files.filter((f: unknown) => typeof f === "string") : [];
  } catch {
    return [];
  }
}

/** Format a single successful task entry with optional file list, respecting char budget. */
function formatSuccessEntry(
  task: TaskRecord,
  index: number,
  charCount: number,
): { lines: string[]; charCount: number; overBudget: boolean } {
  const lines: string[] = [];
  const summary = `${index + 1}. ${summarizeTask(task)}`;
  if (charCount + summary.length + 1 > MAX_CONTEXT_CHARS) {
    return { lines, charCount, overBudget: true };
  }
  lines.push(summary);
  charCount += summary.length + 1;

  const files = extractFiles(task);
  const hasCompactFileList = files.length > 0 && files.length <= 3;
  if (hasCompactFileList) {
    const fileLine = `   Files: ${files.join(", ")}`;
    const fitsInBudget = charCount + fileLine.length + 1 <= MAX_CONTEXT_CHARS;
    if (fitsInBudget) {
      lines.push(fileLine);
      charCount += fileLine.length + 1;
    }
  }

  return { lines, charCount, overBudget: false };
}

/**
 * Build a summarized operational memory string for LLM prompt injection.
 * Produces concise, actionable summaries instead of raw log lines.
 * Returns null if there's no useful history.
 */
export function buildMemoryContextString(ctx: MemoryContext): string | null {
  if (ctx.recentTasks.length === 0) return null;

  const lines: string[] = [];

  if (ctx.isContinuation && ctx.continuationOf) {
    lines.push(`Continuing previous work: "${truncate(ctx.continuationOf.prompt, 80)}"`);
    lines.push("");
  }

  const successful = ctx.recentTasks.filter((t) => t.status === "success").slice(0, 5);
  const failed = ctx.recentTasks.filter((t) => t.status === "failure").slice(0, 3);

  if (successful.length > 0) {
    lines.push("Recent successful operations:");
    let charCount = lines.join("\n").length;
    for (let i = 0; i < successful.length; i++) {
      const entry = formatSuccessEntry(successful[i], i, charCount);
      if (entry.overBudget) break;
      lines.push(...entry.lines);
      charCount = entry.charCount;
    }
  }

  if (failed.length > 0) {
    lines.push("");
    lines.push("Recent failures (avoid repeating):");
    for (const t of failed) {
      lines.push(`- ${summarizeTask(t)}`);
    }
  }

  lines.push("");
  lines.push("Avoid repeating tasks already completed successfully.");

  return lines.join("\n");
}
