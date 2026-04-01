import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────

/** Memory categories, matching the four-type taxonomy. */
export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  /** Unique slug-based filename (without extension). */
  id: string;
  name: string;
  description: string;
  type: MemoryType;
  /** ISO timestamp when the memory was created or last updated. */
  updatedAt: string;
  /** The actual memory content (markdown body after frontmatter). */
  content: string;
}

export interface MemoryStoreOptions {
  /** Root directory for all memories. Defaults to `~/.dojops/memory/`. */
  baseDir?: string;
  /** Project identifier (hashed to create the project subdirectory). */
  projectId: string;
  /** Maximum lines in MEMORY.md index (default: 200). */
  maxIndexLines?: number;
}

/** Result from the relevance scanner — a scored subset of memories. */
export interface ScoredMemory {
  entry: MemoryEntry;
  /** Relevance score (0-1) assigned by the scanner. */
  score: number;
}

// ── Frontmatter parsing ──────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }
  return { meta, body: match[2].trim() };
}

function toFrontmatter(entry: MemoryEntry): string {
  return [
    "---",
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `type: ${entry.type}`,
    `updatedAt: ${entry.updatedAt}`,
    "---",
    "",
    entry.content,
    "",
  ].join("\n");
}

// ── MemoryStore ──────────────────────────────────────────────────────

/**
 * Persistent cross-session memory store.
 *
 * Stores memories as individual `.md` files with YAML frontmatter in
 * `~/.dojops/memory/<project-hash>/`. Maintains a `MEMORY.md` index
 * (max 200 lines) that serves as a quick-load summary for context injection.
 */
export class MemoryStore {
  readonly memoryDir: string;
  private readonly maxIndexLines: number;

  constructor(opts: MemoryStoreOptions) {
    const base = opts.baseDir ?? path.join(homedir(), ".dojops", "memory");
    const hash = crypto.createHash("sha256").update(opts.projectId).digest("hex").slice(0, 12);
    this.memoryDir = path.join(base, hash);
    this.maxIndexLines = opts.maxIndexLines ?? 200;
  }

  /** Ensure the memory directory exists. */
  private ensureDir(): void {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  /** Save or update a memory entry. Creates the file and updates the index. */
  save(entry: MemoryEntry): void {
    this.ensureDir();
    const filePath = path.join(this.memoryDir, `${entry.id}.md`);
    fs.writeFileSync(filePath, toFrontmatter(entry), "utf-8");
    this.rebuildIndex();
  }

  /** Load a single memory by ID. Returns null if not found. */
  load(id: string): MemoryEntry | null {
    const filePath = path.join(this.memoryDir, `${id}.md`);
    if (!fs.existsSync(filePath)) return null;
    return this.parseFile(filePath, id);
  }

  /** Delete a memory by ID. Returns true if deleted. */
  delete(id: string): boolean {
    const filePath = path.join(this.memoryDir, `${id}.md`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    this.rebuildIndex();
    return true;
  }

  /** List all memory entries (reads all .md files except MEMORY.md). */
  list(): MemoryEntry[] {
    if (!fs.existsSync(this.memoryDir)) return [];

    const files = fs
      .readdirSync(this.memoryDir)
      .filter((f) => f.endsWith(".md") && f !== "MEMORY.md");

    const entries: MemoryEntry[] = [];
    for (const file of files) {
      const id = file.replace(/\.md$/, "");
      const entry = this.parseFile(path.join(this.memoryDir, file), id);
      if (entry) entries.push(entry);
    }

    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** List memories filtered by type. */
  listByType(type: MemoryType): MemoryEntry[] {
    return this.list().filter((e) => e.type === type);
  }

  /** Read the MEMORY.md index content (for context injection). */
  readIndex(): string {
    const indexPath = path.join(this.memoryDir, "MEMORY.md");
    if (!fs.existsSync(indexPath)) return "";
    return fs.readFileSync(indexPath, "utf-8");
  }

  /** Rebuild the MEMORY.md index from all memory files. */
  rebuildIndex(): void {
    this.ensureDir();
    const entries = this.list();
    const lines: string[] = ["# Memory Index", ""];

    // Group by type
    const grouped = new Map<MemoryType, MemoryEntry[]>();
    for (const entry of entries) {
      const group = grouped.get(entry.type) ?? [];
      group.push(entry);
      grouped.set(entry.type, group);
    }

    const typeOrder: MemoryType[] = ["user", "feedback", "project", "reference"];
    for (const type of typeOrder) {
      const group = grouped.get(type);
      if (!group || group.length === 0) continue;

      lines.push(`## ${type}`);
      for (const entry of group) {
        // One-line pointer: under 150 chars
        const line = `- [${entry.name}](${entry.id}.md) — ${entry.description}`;
        lines.push(line.length > 150 ? line.slice(0, 147) + "..." : line);
      }
      lines.push("");
    }

    // Truncate to max index lines
    const output = lines.slice(0, this.maxIndexLines).join("\n");
    fs.writeFileSync(path.join(this.memoryDir, "MEMORY.md"), output, "utf-8");
  }

  /** Parse a memory file into a MemoryEntry. */
  private parseFile(filePath: string, id: string): MemoryEntry | null {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = parseFrontmatter(raw);
      if (!parsed) return null;

      const { meta, body } = parsed;
      if (!meta.name || !meta.type) return null;

      return {
        id,
        name: meta.name,
        description: meta.description ?? "",
        type: meta.type as MemoryType,
        updatedAt: meta.updatedAt ?? new Date().toISOString(),
        content: body,
      };
    } catch {
      return null;
    }
  }
}

// ── MemoryScanner ────────────────────────────────────────────────────

export interface MemoryScannerOptions {
  /** LLM provider to use for relevance scoring (should be fast/cheap model). */
  generate: (prompt: string) => Promise<string>;
  /** Max memories to return (default: 5). */
  topK?: number;
}

/**
 * Scans stored memories for relevance to the current context.
 * Uses a fast LLM call to rank memories and return the top-K most relevant.
 */
export class MemoryScanner {
  private readonly generate: (prompt: string) => Promise<string>;
  private readonly topK: number;

  constructor(opts: MemoryScannerOptions) {
    this.generate = opts.generate;
    this.topK = opts.topK ?? 5;
  }

  /**
   * Pick the most relevant memories for a given context string.
   * Falls back to recency-based selection if LLM scoring fails.
   */
  async scan(store: MemoryStore, context: string): Promise<ScoredMemory[]> {
    const all = store.list();
    if (all.length === 0) return [];

    // If fewer than topK, return all with score 1.0
    if (all.length <= this.topK) {
      return all.map((entry) => ({ entry, score: 1.0 }));
    }

    try {
      return await this.llmRank(all, context);
    } catch {
      // Fallback: return most recent entries
      return all.slice(0, this.topK).map((entry, i) => ({
        entry,
        score: 1.0 - i * 0.1,
      }));
    }
  }

  private async llmRank(entries: MemoryEntry[], context: string): Promise<ScoredMemory[]> {
    const summaries = entries
      .map((e, i) => `[${i}] (${e.type}) ${e.name}: ${e.description}`)
      .join("\n");

    const prompt = [
      "You are a memory relevance scorer. Given a context and a list of stored memories,",
      `return the indices of the ${this.topK} most relevant memories as a JSON array of numbers.`,
      "Only return the JSON array, nothing else.",
      "",
      "Context:",
      context.slice(0, 2000),
      "",
      "Memories:",
      summaries,
      "",
      `Return the ${this.topK} most relevant indices as JSON (e.g. [2, 0, 5]):`,
    ].join("\n");

    const response = await this.generate(prompt);

    // Parse the JSON array of indices
    const cleaned = response
      .replace(/```json?\s*/g, "")
      .replace(/```/g, "")
      .trim();
    const indices: number[] = JSON.parse(cleaned);

    if (!Array.isArray(indices)) {
      throw new Error("Expected JSON array of indices");
    }

    return indices
      .filter((i) => typeof i === "number" && i >= 0 && i < entries.length)
      .slice(0, this.topK)
      .map((idx, rank) => ({
        entry: entries[idx],
        score: 1.0 - rank * (0.8 / this.topK),
      }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Cross-platform home directory. */
function homedir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
}

/** Generate a slug-safe ID from a name string. */
export function toMemoryId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
