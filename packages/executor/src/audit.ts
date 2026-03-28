import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ExecutionAuditEntry } from "./types";

/**
 * Compute a SHA-256 hash over all non-hash fields of an audit entry,
 * chained with the previous entry's hash.
 */
export function computeAuditHash(entry: ExecutionAuditEntry, previousHash: string): string {
  const payload = { ...entry, hash: undefined, previousHash };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Persists audit entries as newline-delimited JSON (JSONL) to `.dojops/audit.jsonl`.
 * Each entry includes a `hash` and `previousHash` field forming a hash chain.
 */
export class AuditPersistence {
  private readonly filePath: string;
  private readonly headFilePath: string;
  private readonly genesisHash: string;
  private lastHash: string;

  constructor(projectRoot: string) {
    const dir = path.join(projectRoot, ".dojops");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, "audit.jsonl");
    this.headFilePath = path.join(dir, "audit-head.json");
    this.genesisHash = this.loadGenesisHash();
    this.lastHash = this.readLastHash();
  }

  /** Append an audit entry with hash chain fields. Mutates the entry in-place. */
  append(entry: ExecutionAuditEntry): void {
    const isFirstEntry = this.lastHash === this.genesisHash;
    entry.previousHash = this.lastHash;
    entry.hash = computeAuditHash(entry, this.lastHash);
    this.lastHash = entry.hash;

    fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n");

    // H-1: Store first entry hash for truncation detection
    if (isFirstEntry) {
      this.writeHead(entry.hash);
    }
  }

  /** Read all persisted audit entries, skipping corrupt lines. */
  readAll(): ExecutionAuditEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
    const entries: ExecutionAuditEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]) as ExecutionAuditEntry);
      } catch {
        console.warn(`[audit] corrupt entry at line ${i + 1}, skipping`);
      }
    }
    return entries;
  }

  /**
   * Verify the integrity of the persisted audit chain.
   * Returns the index of the first broken entry, or -1 if the chain is valid.
   */
  verify(): { valid: boolean; brokenAt: number; truncated?: boolean } {
    const entries = this.readAll();
    if (entries.length === 0) return { valid: true, brokenAt: -1 };

    let expectedPrevious = this.genesisHash;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.previousHash !== expectedPrevious) {
        return { valid: false, brokenAt: i };
      }
      const recomputed = computeAuditHash(entry, entry.previousHash!);
      if (entry.hash !== recomputed) {
        return { valid: false, brokenAt: i };
      }
      expectedPrevious = entry.hash!;
    }

    // H-1: Check for truncation — first entry should match the head marker
    const head = this.readHead();
    if (head && entries.length > 0) {
      if (entries[0].hash !== head.firstEntryHash) {
        return { valid: false, brokenAt: 0, truncated: true };
      }
    }

    return { valid: true, brokenAt: -1 };
  }

  /** Write the head marker file with the first entry's hash. */
  private writeHead(firstEntryHash: string): void {
    try {
      fs.writeFileSync(
        this.headFilePath,
        JSON.stringify({
          firstEntryHash,
          genesisHash: this.genesisHash,
          createdAt: new Date().toISOString(),
        }),
      );
    } catch {
      // Best-effort — non-fatal
    }
  }

  /** Read the head marker to detect chain truncation. */
  readHead(): { firstEntryHash: string; genesisHash: string } | null {
    try {
      if (!fs.existsSync(this.headFilePath)) return null;
      return JSON.parse(fs.readFileSync(this.headFilePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Load or generate the genesis hash. Stored in audit-head.json for persistence. */
  private loadGenesisHash(): string {
    try {
      if (fs.existsSync(this.headFilePath)) {
        const head = JSON.parse(fs.readFileSync(this.headFilePath, "utf-8"));
        if (typeof head.genesisHash === "string") return head.genesisHash;
      }
    } catch {
      // Fall through to generate
    }
    // Generate a random genesis hash — stored when the first entry is appended
    return randomBytes(32).toString("hex");
  }

  /** Read the hash of the last entry from the file, or the genesis hash if empty. */
  private readLastHash(): string {
    if (!fs.existsSync(this.filePath)) return this.genesisHash;
    const content = fs.readFileSync(this.filePath, "utf-8").trimEnd();
    if (!content) return this.genesisHash;

    const lastLine = content.split("\n").pop();
    if (!lastLine) return this.genesisHash;

    try {
      const entry = JSON.parse(lastLine) as ExecutionAuditEntry;
      return entry.hash ?? this.genesisHash;
    } catch {
      return this.genesisHash;
    }
  }
}
