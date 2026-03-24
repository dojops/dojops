import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "@dojops/core";

export { redactSecrets };

export interface HistoryEntry {
  id: string;
  type: "generate" | "plan" | "debug-ci" | "diff" | "scan" | "chat" | "review" | "auto";
  request: unknown;
  response: unknown;
  timestamp: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/** Deep-clone a value and redact secrets in all string fields. */
function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = redactDeep(v);
    }
    return result;
  }
  return value;
}

/**
 * Operation history store with optional file persistence.
 * When persistDir is set, entries are appended to a JSONL file and
 * loaded on construction.
 */
export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private readonly idIndex = new Map<string, HistoryEntry>();
  private readonly maxEntries: number;
  private readonly persistPath: string | null;

  constructor(maxEntries = 1000, persistDir?: string) {
    this.maxEntries = maxEntries;
    this.persistPath = null;

    if (persistDir) {
      try {
        fs.mkdirSync(persistDir, { recursive: true });
        this.persistPath = path.join(persistDir, "history.jsonl");
        this.loadFromDisk();
      } catch (err) {
        console.warn(`[HistoryStore] Failed to initialize persistence: ${err}`);
        // Continue without persistence
      }
    }
  }

  private generateId(): string {
    return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  }

  /** Load existing entries from JSONL file on disk. */
  private loadFromDisk(): void {
    if (!this.persistPath) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const content = fs.readFileSync(this.persistPath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as HistoryEntry;
          this.entries.push(entry);
          this.idIndex.set(entry.id, entry);
        } catch {
          // Skip malformed lines
        }
      }
      // Trim to maxEntries if file had more
      if (this.entries.length > this.maxEntries) {
        const evicted = this.entries.splice(0, this.entries.length - this.maxEntries);
        for (const e of evicted) {
          this.idIndex.delete(e.id);
        }
      }
    } catch {
      // File read failed — start fresh
    }
  }

  /** Append a single entry to the JSONL file. */
  private appendToDisk(entry: HistoryEntry): void {
    if (!this.persistPath) return;
    try {
      fs.appendFileSync(this.persistPath, JSON.stringify(entry) + "\n");
    } catch {
      // Silently ignore write failures — in-memory store still works
    }
  }

  add(entry: Omit<HistoryEntry, "id" | "timestamp">): HistoryEntry {
    // G-10: Redact secrets from request and response before storing
    const redactedEntry = {
      ...entry,
      request: redactDeep(entry.request),
      response: redactDeep(entry.response),
      error: entry.error ? redactSecrets(entry.error) : entry.error,
    };

    const full: HistoryEntry = {
      ...redactedEntry,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);
    this.idIndex.set(full.id, full);
    // Evict oldest entries when at capacity
    if (this.entries.length > this.maxEntries) {
      const evicted = this.entries.splice(0, this.entries.length - this.maxEntries);
      for (const e of evicted) {
        this.idIndex.delete(e.id);
      }
    }

    this.appendToDisk(full);

    return full;
  }

  getAll(opts?: { type?: string; limit?: number }): HistoryEntry[] {
    let result = [...this.entries].reverse();
    if (opts?.type) {
      result = result.filter((e) => e.type === opts.type);
    }
    if (opts?.limit && opts.limit > 0) {
      result = result.slice(0, opts.limit);
    }
    return result;
  }

  getById(id: string): HistoryEntry | undefined {
    return this.idIndex.get(id);
  }

  clear(): void {
    this.entries = [];
    this.idIndex.clear();
    // SA-14: Truncate persisted JSONL file on clear
    if (this.persistPath) {
      try {
        fs.writeFileSync(this.persistPath, "", "utf-8");
      } catch {
        // Best-effort — in-memory store is already cleared
      }
    }
  }
}

/** Extract a message string from an unknown error value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Log a failed route operation to the history store. */
export function logRouteError(
  store: HistoryStore,
  type: HistoryEntry["type"],
  request: unknown,
  start: number,
  err: unknown,
): void {
  store.add({
    type,
    request,
    response: null,
    durationMs: Date.now() - start,
    success: false,
    error: toErrorMessage(err),
  });
}
