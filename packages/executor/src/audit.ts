import { createHash } from "node:crypto";
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
  private lastHash: string;

  constructor(projectRoot: string) {
    const dir = path.join(projectRoot, ".dojops");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, "audit.jsonl");
    this.lastHash = this.readLastHash();
  }

  /** Append an audit entry with hash chain fields. Mutates the entry in-place. */
  append(entry: ExecutionAuditEntry): void {
    entry.previousHash = this.lastHash;
    entry.hash = computeAuditHash(entry, this.lastHash);
    this.lastHash = entry.hash;

    fs.appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
  }

  /** Read all persisted audit entries. */
  readAll(): ExecutionAuditEntry[] {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, "utf-8").split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as ExecutionAuditEntry);
  }

  /**
   * Verify the integrity of the persisted audit chain.
   * Returns the index of the first broken entry, or -1 if the chain is valid.
   */
  verify(): { valid: boolean; brokenAt: number } {
    const entries = this.readAll();
    if (entries.length === 0) return { valid: true, brokenAt: -1 };

    let expectedPrevious = "GENESIS";
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
    return { valid: true, brokenAt: -1 };
  }

  /** Read the hash of the last entry from the file, or "GENESIS" if empty. */
  private readLastHash(): string {
    if (!fs.existsSync(this.filePath)) return "GENESIS";
    const content = fs.readFileSync(this.filePath, "utf-8").trimEnd();
    if (!content) return "GENESIS";

    const lastLine = content.split("\n").pop();
    if (!lastLine) return "GENESIS";

    try {
      const entry = JSON.parse(lastLine) as ExecutionAuditEntry;
      return entry.hash ?? "GENESIS";
    } catch {
      return "GENESIS";
    }
  }
}
