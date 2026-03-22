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
  agent_or_skill: string;
  metadata: string;
}

export interface NoteRecord {
  id: number;
  timestamp: string;
  category: string;
  content: string;
  keywords: string;
}

export interface ErrorPattern {
  id: number;
  fingerprint: string;
  error_message: string;
  task_type: string;
  agent_or_skill: string;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  resolution: string;
}

export interface MemoryContext {
  recentTasks: TaskRecord[];
  relatedTasks: TaskRecord[];
  isContinuation: boolean;
  continuationOf?: TaskRecord;
  relevantNotes: NoteRecord[];
  errorWarnings: ErrorPattern[];
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
  agent_or_skill  TEXT    NOT NULL DEFAULT '',
  metadata         TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_tasks_history_type_ts
  ON tasks_history(task_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_history_ts
  ON tasks_history(timestamp DESC);

CREATE TABLE IF NOT EXISTS notes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp        TEXT    NOT NULL,
  category         TEXT    NOT NULL DEFAULT 'general',
  content          TEXT    NOT NULL,
  keywords         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_notes_category
  ON notes(category);
CREATE INDEX IF NOT EXISTS idx_notes_ts
  ON notes(timestamp DESC);

CREATE TABLE IF NOT EXISTS error_patterns (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint      TEXT    NOT NULL UNIQUE,
  error_message    TEXT    NOT NULL,
  task_type        TEXT    NOT NULL,
  agent_or_skill  TEXT    NOT NULL DEFAULT '',
  occurrences      INTEGER NOT NULL DEFAULT 1,
  first_seen       TEXT    NOT NULL,
  last_seen        TEXT    NOT NULL,
  resolution       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_error_patterns_type
  ON error_patterns(task_type);
CREATE INDEX IF NOT EXISTS idx_error_patterns_occurrences
  ON error_patterns(occurrences DESC);
`;

// ── Memory config ──────────────────────────────────────────────────

/** Check if auto-enrichment is enabled for a project. Defaults to true. */
export function loadMemoryConfig(rootDir: string): boolean {
  try {
    const configPath = path.join(rootDir, ".dojops", MEMORY_DIR, "config.json");
    if (!fs.existsSync(configPath)) return true; // enabled by default
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return config.autoEnrich !== false;
  } catch {
    return true;
  }
}

/** Save auto-enrichment config. */
export function saveMemoryConfig(rootDir: string, autoEnrich: boolean): void {
  const dir = memoryDir(rootDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ autoEnrich }, null, 2));
}

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

/** Record a completed task. If the task failed, also records the error pattern. */
export function recordTask(rootDir: string, record: Omit<TaskRecord, "id">): void {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return;

    db.prepare(
      `
      INSERT INTO tasks_history
        (timestamp, task_type, prompt, result_summary, status,
         duration_ms, related_files, agent_or_skill, metadata)
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
      record.agent_or_skill,
      record.metadata,
    );

    // Auto-learn error patterns from failures
    if (record.status === "failure" && record.result_summary) {
      recordError(rootDir, record.result_summary, record.task_type, record.agent_or_skill);
    }
  } catch {
    // silent — memory is non-critical
  }
}

/**
 * Record a command-level error for pattern learning.
 * Called from the main error handler to capture errors that bypass recordTask.
 */
export function recordCommandError(rootDir: string, command: string, errorMsg: string): void {
  recordError(rootDir, errorMsg, command);
}

// ── Notes CRUD ────────────────────────────────────────────────────

/** Add a note to the memory database. Returns the inserted ID or -1 on failure. */
export function addNote(
  rootDir: string,
  content: string,
  category = "general",
  keywords = "",
): number {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return -1;

    const result = db
      .prepare(
        `INSERT INTO notes (timestamp, category, content, keywords)
         VALUES (?, ?, ?, ?)`,
      )
      .run(new Date().toISOString(), category, content, keywords);
    return Number(result.lastInsertRowid);
  } catch {
    return -1;
  }
}

/** List notes, optionally filtered by category. */
export function listNotes(rootDir: string, category?: string, limit = 50): NoteRecord[] {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return [];

    if (category) {
      return db
        .prepare(`SELECT * FROM notes WHERE category = ? ORDER BY id DESC LIMIT ?`)
        .all(category, limit) as NoteRecord[];
    }
    return db.prepare(`SELECT * FROM notes ORDER BY id DESC LIMIT ?`).all(limit) as NoteRecord[];
  } catch {
    return [];
  }
}

/** Remove a note by ID. Returns true if a row was deleted. */
export function removeNote(rootDir: string, id: number): boolean {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return false;

    const result = db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

/** Remove all notes. Returns the number of deleted rows. */
export function clearNotes(rootDir: string): number {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return 0;

    const result = db.prepare(`DELETE FROM notes`).run();
    return result.changes;
  } catch {
    return 0;
  }
}

/** Search notes by keyword match against content and keywords fields. */
export function searchNotes(rootDir: string, query: string, limit = 20): NoteRecord[] {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return [];

    const words = tokenize(query);
    if (words.length === 0) return listNotes(rootDir, undefined, limit);

    // Build LIKE clauses for each word against content + keywords
    const conditions = words
      .map(() => `(LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?)`)
      .join(" AND ");
    const params: string[] = [];
    for (const w of words) {
      params.push(`%${w}%`, `%${w}%`);
    }
    params.push(String(limit));

    return db
      .prepare(`SELECT * FROM notes WHERE ${conditions} ORDER BY id DESC LIMIT ?`)
      .all(...params) as NoteRecord[];
  } catch {
    return [];
  }
}

// ── Error Pattern Learning ────────────────────────────────────────

/**
 * Generate a stable fingerprint from an error message.
 * Strips variable parts (paths, IDs, timestamps, numbers) to group similar errors.
 */
export function errorFingerprint(
  errorMsg: string,
  taskType: string,
  agentOrModule: string,
): string {
  const normalized = errorMsg
    .replaceAll(/\/[\w./\\-]+/g, "<path>") // paths
    .replaceAll(/\b[0-9a-f]{8,}\b/gi, "<id>") // hex IDs
    .replaceAll(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}[:\d.Z]*/g, "<ts>") // timestamps
    .replaceAll(/\d+/g, "<n>") // remaining numbers
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 200);
  return `${taskType}:${agentOrModule}:${normalized}`;
}

/** Record an error occurrence. Upserts — increments count if fingerprint exists. */
export function recordError(
  rootDir: string,
  errorMsg: string,
  taskType: string,
  agentOrModule = "",
): void {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return;

    const fp = errorFingerprint(errorMsg, taskType, agentOrModule);
    const now = new Date().toISOString();

    // Truncate error message for storage
    const truncated = errorMsg.length > 500 ? errorMsg.slice(0, 497) + "..." : errorMsg;

    db.prepare(
      `INSERT INTO error_patterns (fingerprint, error_message, task_type, agent_or_skill, occurrences, first_seen, last_seen)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         occurrences = occurrences + 1,
         last_seen = excluded.last_seen,
         error_message = excluded.error_message`,
    ).run(fp, truncated, taskType, agentOrModule, now, now);
  } catch {
    // silent — non-critical
  }
}

/** Mark an error pattern as resolved with a note. */
export function resolveError(rootDir: string, id: number, resolution: string): boolean {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return false;

    const result = db
      .prepare(`UPDATE error_patterns SET resolution = ? WHERE id = ?`)
      .run(resolution, id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

/** List error patterns, sorted by frequency. */
export function listErrorPatterns(rootDir: string, taskType?: string, limit = 20): ErrorPattern[] {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return [];

    if (taskType) {
      return db
        .prepare(
          `SELECT * FROM error_patterns WHERE task_type = ? ORDER BY occurrences DESC LIMIT ?`,
        )
        .all(taskType, limit) as ErrorPattern[];
    }
    return db
      .prepare(`SELECT * FROM error_patterns ORDER BY occurrences DESC LIMIT ?`)
      .all(limit) as ErrorPattern[];
  } catch {
    return [];
  }
}

/** Find error patterns matching keywords in the error message. */
export function findMatchingErrors(
  rootDir: string,
  taskType: string,
  agentOrModule: string,
  limit = 3,
): ErrorPattern[] {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return [];

    // Match by task type + agent/module for relevant warnings
    if (agentOrModule) {
      return db
        .prepare(
          `SELECT * FROM error_patterns
           WHERE task_type = ? AND agent_or_skill = ?
           ORDER BY occurrences DESC, last_seen DESC
           LIMIT ?`,
        )
        .all(taskType, agentOrModule, limit) as ErrorPattern[];
    }
    return db
      .prepare(
        `SELECT * FROM error_patterns
         WHERE task_type = ?
         ORDER BY occurrences DESC, last_seen DESC
         LIMIT ?`,
      )
      .all(taskType, limit) as ErrorPattern[];
  } catch {
    return [];
  }
}

/** Delete an error pattern by ID. */
export function removeErrorPattern(rootDir: string, id: number): boolean {
  try {
    const db = openMemoryDb(rootDir);
    if (!db) return false;

    const result = db.prepare(`DELETE FROM error_patterns WHERE id = ?`).run(id);
    return result.changes > 0;
  } catch {
    return false;
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
    relevantNotes: [],
    errorWarnings: [],
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

    // Fetch notes relevant to the prompt
    const relevantNotes = prompt ? searchNotes(rootDir, prompt, 5) : [];

    // Fetch unresolved error warnings for this task type
    const allErrors = findMatchingErrors(rootDir, taskType, "", 5);
    const errorWarnings = allErrors.filter((e) => !e.resolution);

    return {
      recentTasks,
      relatedTasks,
      isContinuation,
      continuationOf,
      relevantNotes,
      errorWarnings,
    };
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
  const module = t.agent_or_skill ? ` via ${t.agent_or_skill}` : "";
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

/** Format continuation header lines. */
function formatContinuation(ctx: MemoryContext): string[] {
  if (!ctx.isContinuation || !ctx.continuationOf) return [];
  return [`Continuing previous work: "${truncate(ctx.continuationOf.prompt, 80)}"`, ""];
}

/** Format successful operations section. */
function formatSuccessfulOps(tasks: TaskRecord[]): string[] {
  const successful = tasks.filter((t) => t.status === "success").slice(0, 5);
  if (successful.length === 0) return [];

  const lines: string[] = ["Recent successful operations:"];
  let charCount = lines[0].length;
  for (let i = 0; i < successful.length; i++) {
    const entry = formatSuccessEntry(successful[i], i, charCount);
    if (entry.overBudget) break;
    lines.push(...entry.lines);
    charCount = entry.charCount;
  }
  return lines;
}

/** Format failed operations section. */
function formatFailedOps(tasks: TaskRecord[]): string[] {
  const failed = tasks.filter((t) => t.status === "failure").slice(0, 3);
  if (failed.length === 0) return [];
  return ["", "Recent failures (avoid repeating):", ...failed.map((t) => `- ${summarizeTask(t)}`)];
}

/** Format error warnings section. */
function formatErrorWarnings(warnings: ErrorPattern[] | undefined): string[] {
  if (!warnings || warnings.length === 0) return [];
  const lines: string[] = ["", "Known error patterns (watch out for these):"];
  for (const ep of warnings.slice(0, 3)) {
    const count = ep.occurrences > 1 ? ` (occurred ${ep.occurrences}x)` : "";
    lines.push(`- ${truncate(ep.error_message, 100)}${count}`);
  }
  return lines;
}

/** Format project notes section. */
function formatRelevantNotes(notes: NoteRecord[] | undefined): string[] {
  if (!notes || notes.length === 0) return [];
  const lines: string[] = ["", "Project notes:"];
  for (const note of notes) {
    const tag = note.category === "general" ? "" : ` [${note.category}]`;
    lines.push(`- ${truncate(note.content, 120)}${tag}`);
  }
  return lines;
}

/**
 * Build a summarized operational memory string for LLM prompt injection.
 * Produces concise, actionable summaries instead of raw log lines.
 * Returns null if there's no useful history.
 */
export function buildMemoryContextString(ctx: MemoryContext): string | null {
  if (ctx.recentTasks.length === 0) return null;

  const lines: string[] = [
    ...formatContinuation(ctx),
    ...formatSuccessfulOps(ctx.recentTasks),
    ...formatFailedOps(ctx.recentTasks),
    ...formatErrorWarnings(ctx.errorWarnings),
    ...formatRelevantNotes(ctx.relevantNotes),
    "",
    "Avoid repeating tasks already completed successfully.",
  ];

  return lines.join("\n");
}
