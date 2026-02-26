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

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private nextId = 1;
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  add(entry: Omit<HistoryEntry, "id" | "timestamp">): HistoryEntry {
    const full: HistoryEntry = {
      ...entry,
      id: String(this.nextId++),
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);
    // Evict oldest entries when at capacity
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
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
    return this.entries.find((e) => e.id === id);
  }

  clear(): void {
    this.entries = [];
    this.nextId = 1;
  }
}
