import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function createTempDir(prefix = "dojops-metrics-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function computeAuditHash(entry: Record<string, unknown>): string {
  const payload = JSON.stringify({
    ...entry,
    hash: undefined,
    previousHash: (entry.previousHash as string) ?? "genesis",
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function writeAuditEntries(dojopsDir: string, entries: Array<Record<string, unknown>>) {
  let previousHash = "genesis";
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e: Record<string, unknown> = { ...entries[i], seq: i + 1, previousHash };
    e.hash = computeAuditHash(e);
    previousHash = e.hash as string;
    lines.push(JSON.stringify(e));
  }
  fs.writeFileSync(path.join(dojopsDir, "history", "audit.jsonl"), lines.join("\n") + "\n");
}
