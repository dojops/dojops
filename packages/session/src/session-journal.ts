import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * A single entry in the session journal.
 * Each entry is written as one JSON line in the JSONL file.
 */
export interface JournalEntry {
  /** Entry type: what happened. */
  type:
    | "user"
    | "assistant"
    | "tool_call"
    | "tool_result"
    | "system"
    | "compaction"
    | "error"
    | "metadata";
  /** ISO timestamp of when this entry was written. */
  timestamp: string;
  /** Session ID this entry belongs to. */
  sessionId: string;
  /** The payload. Structure depends on entry type. */
  data: Record<string, unknown>;
}

export interface SessionJournalOptions {
  /** Root directory for journal files. Defaults to ~/.dojops/sessions/ */
  rootDir?: string;
  /** Session ID. If omitted, a new one is generated. */
  sessionId?: string;
}

/**
 * Append-only JSONL session transcript.
 *
 * Each message, tool call, and tool result is written as a single JSON line
 * the moment it occurs. If the process crashes, all entries up to the last
 * flush are preserved and the session can be resumed.
 *
 * Journal files are stored at:
 *   {rootDir}/.dojops/journals/{sessionId}.jsonl
 *
 * This complements (not replaces) the existing JSON serializer which writes
 * full session snapshots for the API/dashboard.
 */
export class SessionJournal {
  readonly sessionId: string;
  private readonly journalPath: string;
  private readonly journalDir: string;
  private fd: number | null = null;
  private entryCount = 0;

  constructor(opts: SessionJournalOptions = {}) {
    this.sessionId = opts.sessionId ?? SessionJournal.generateId();
    const root = opts.rootDir ?? SessionJournal.defaultRootDir();
    this.journalDir = path.join(root, ".dojops", "journals");
    this.journalPath = path.join(this.journalDir, `${this.sessionId}.jsonl`);
  }

  /** Open the journal file for appending. Creates the directory if needed. */
  open(): void {
    if (this.fd !== null) return;
    if (!fs.existsSync(this.journalDir)) {
      fs.mkdirSync(this.journalDir, { recursive: true });
    }
    this.fd = fs.openSync(this.journalPath, "a");

    // Count existing entries (for resume)
    if (fs.existsSync(this.journalPath)) {
      try {
        const content = fs.readFileSync(this.journalPath, "utf-8");
        this.entryCount = content.split("\n").filter(Boolean).length;
      } catch {
        this.entryCount = 0;
      }
    }
  }

  /** Append a journal entry. Auto-opens the file if not already open. */
  append(type: JournalEntry["type"], data: Record<string, unknown>): void {
    if (this.fd === null) this.open();

    const entry: JournalEntry = {
      type,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      data,
    };

    const line = JSON.stringify(entry) + "\n";
    fs.writeSync(this.fd!, line);
    this.entryCount++;
  }

  /** Convenience: write a user message entry. */
  writeUserMessage(content: string): void {
    this.append("user", { content });
  }

  /** Convenience: write an assistant message entry. */
  writeAssistantMessage(content: string, toolCalls?: unknown[]): void {
    const data: Record<string, unknown> = { content };
    if (toolCalls && toolCalls.length > 0) data.toolCalls = toolCalls;
    this.append("assistant", data);
  }

  /** Convenience: write a tool call entry. */
  writeToolCall(callId: string, name: string, args: Record<string, unknown>): void {
    this.append("tool_call", { callId, name, arguments: args });
  }

  /** Convenience: write a tool result entry. */
  writeToolResult(callId: string, output: string, isError?: boolean): void {
    const data: Record<string, unknown> = { callId, output };
    if (isError) data.isError = true;
    this.append("tool_result", data);
  }

  /** Convenience: write a compaction event. */
  writeCompaction(tier: string, messagesBefore: number, messagesAfter: number): void {
    this.append("compaction", { tier, messagesBefore, messagesAfter });
  }

  /** Convenience: write session metadata (e.g. provider, budget snapshot). */
  writeMetadata(data: Record<string, unknown>): void {
    this.append("metadata", data);
  }

  /** Close the file descriptor. */
  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }

  /** Number of entries written (or present from a resumed session). */
  getEntryCount(): number {
    return this.entryCount;
  }

  /** Read all entries from the journal file. Returns empty array if file doesn't exist. */
  readAll(): JournalEntry[] {
    if (!fs.existsSync(this.journalPath)) return [];
    try {
      const content = fs.readFileSync(this.journalPath, "utf-8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JournalEntry);
    } catch {
      return [];
    }
  }

  /** Get the file path of this journal. */
  getPath(): string {
    return this.journalPath;
  }

  /** Check if a journal file exists for the given session ID. */
  static exists(sessionId: string, rootDir?: string): boolean {
    const root = rootDir ?? SessionJournal.defaultRootDir();
    const file = path.join(root, ".dojops", "journals", `${sessionId}.jsonl`);
    return fs.existsSync(file);
  }

  /** List all journal session IDs, sorted by most recent modification. */
  static list(rootDir?: string): string[] {
    const root = rootDir ?? SessionJournal.defaultRootDir();
    const dir = path.join(root, ".dojops", "journals");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        id: f.replace(/\.jsonl$/, ""),
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((e) => e.id);
  }

  /** Delete a journal file. */
  static delete(sessionId: string, rootDir?: string): boolean {
    const root = rootDir ?? SessionJournal.defaultRootDir();
    const file = path.join(root, ".dojops", "journals", `${sessionId}.jsonl`);
    try {
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }

  /** Clean up journal files older than the given TTL (default: 7 days). */
  static cleanExpired(rootDir?: string, ttlMs?: number): number {
    const ttl = ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    const root = rootDir ?? SessionJournal.defaultRootDir();
    const dir = path.join(root, ".dojops", "journals");
    if (!fs.existsSync(dir)) return 0;

    const now = Date.now();
    let deleted = 0;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > ttl) {
          fs.unlinkSync(filePath);
          deleted++;
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }
    return deleted;
  }

  static generateId(): string {
    return `journal-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  }

  private static defaultRootDir(): string {
    return process.env.HOME ?? process.cwd();
  }
}
