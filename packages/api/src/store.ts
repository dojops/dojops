import crypto from "node:crypto";

export interface HistoryEntry {
  id: string;
  type: "generate" | "plan" | "debug-ci" | "diff" | "scan" | "chat";
  request: unknown;
  response: unknown;
  timestamp: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * In-memory operation history. Data is lost on server restart.
 * For persistent storage, see roadmap Phase 9 (Enterprise Readiness).
 */
export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private readonly idIndex = new Map<string, HistoryEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  private generateId(): string {
    return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  }

  add(entry: Omit<HistoryEntry, "id" | "timestamp">): HistoryEntry {
    const full: HistoryEntry = {
      ...entry,
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
