import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AuditPersistence, computeAuditHash } from "../audit";
import type { ExecutionAuditEntry } from "../types";
import { DEFAULT_POLICY } from "../policy";

function makeEntry(overrides: Partial<ExecutionAuditEntry> = {}): ExecutionAuditEntry {
  return {
    taskId: "task-1",
    skillName: "terraform",
    timestamp: new Date().toISOString(),
    policy: DEFAULT_POLICY,
    approval: "approved",
    status: "completed",
    filesWritten: ["main.tf"],
    filesModified: [],
    durationMs: 100,
    ...overrides,
  };
}

describe("AuditPersistence", () => {
  let tmpDir: string;
  let persistence: AuditPersistence;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
    persistence = new AuditPersistence(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .dojops directory and audit.jsonl on first append", () => {
    const entry = makeEntry();
    persistence.append(entry);

    const auditFile = path.join(tmpDir, ".dojops", "audit.jsonl");
    expect(fs.existsSync(auditFile)).toBe(true);
  });

  it("sets hash and previousHash on appended entries", () => {
    const entry = makeEntry();
    persistence.append(entry);

    expect(entry.hash).toBeDefined();
    expect(entry.previousHash).toBe("GENESIS");
    expect(entry.hash!.length).toBe(64); // SHA-256 hex
  });

  it("chains hashes across entries", () => {
    const e1 = makeEntry({ taskId: "task-1" });
    const e2 = makeEntry({ taskId: "task-2" });
    persistence.append(e1);
    persistence.append(e2);

    expect(e2.previousHash).toBe(e1.hash);
  });

  it("readAll returns persisted entries", () => {
    persistence.append(makeEntry({ taskId: "a" }));
    persistence.append(makeEntry({ taskId: "b" }));

    const all = persistence.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].taskId).toBe("a");
    expect(all[1].taskId).toBe("b");
  });

  it("verify returns valid for untampered chain", () => {
    persistence.append(makeEntry({ taskId: "a" }));
    persistence.append(makeEntry({ taskId: "b" }));
    persistence.append(makeEntry({ taskId: "c" }));

    const result = persistence.verify();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBe(-1);
  });

  it("verify detects tampered entry", () => {
    persistence.append(makeEntry({ taskId: "a" }));
    persistence.append(makeEntry({ taskId: "b" }));

    // Tamper with the file: change taskId in the first entry
    const auditFile = path.join(tmpDir, ".dojops", "audit.jsonl");
    const lines = fs.readFileSync(auditFile, "utf-8").split("\n").filter(Boolean);
    const first = JSON.parse(lines[0]);
    first.taskId = "tampered";
    lines[0] = JSON.stringify(first);
    fs.writeFileSync(auditFile, lines.join("\n") + "\n");

    const result = persistence.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("verify detects broken chain link", () => {
    persistence.append(makeEntry({ taskId: "a" }));
    persistence.append(makeEntry({ taskId: "b" }));

    // Tamper with the second entry's previousHash
    const auditFile = path.join(tmpDir, ".dojops", "audit.jsonl");
    const lines = fs.readFileSync(auditFile, "utf-8").split("\n").filter(Boolean);
    const second = JSON.parse(lines[1]);
    second.previousHash = "0".repeat(64);
    // Recompute hash with wrong previousHash to make it internally consistent but chain-broken
    second.hash = computeAuditHash(second, second.previousHash);
    lines[1] = JSON.stringify(second);
    fs.writeFileSync(auditFile, lines.join("\n") + "\n");

    const result = persistence.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("verify returns valid for empty log", () => {
    const result = persistence.verify();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBe(-1);
  });

  it("readAll skips corrupt JSONL lines and returns valid entries", () => {
    persistence.append(makeEntry({ taskId: "valid-1" }));
    persistence.append(makeEntry({ taskId: "valid-2" }));

    // Inject a corrupt line into the audit file
    const auditFile = path.join(tmpDir, ".dojops", "audit.jsonl");
    const content = fs.readFileSync(auditFile, "utf-8");
    fs.writeFileSync(auditFile, content + "NOT_VALID_JSON\n");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const entries = persistence.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].taskId).toBe("valid-1");
    expect(entries[1].taskId).toBe("valid-2");

    expect(warnSpy).toHaveBeenCalledWith("[audit] corrupt entry at line 3, skipping");
    warnSpy.mockRestore();
  });

  it("readAll handles file with only corrupt entries", () => {
    const auditFile = path.join(tmpDir, ".dojops", "audit.jsonl");
    fs.writeFileSync(auditFile, "CORRUPT_LINE_1\nCORRUPT_LINE_2\n");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const entries = persistence.readAll();
    expect(entries).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it("resumes hash chain from existing file", () => {
    // Write some entries
    persistence.append(makeEntry({ taskId: "a" }));
    persistence.append(makeEntry({ taskId: "b" }));
    const entries = persistence.readAll();
    const lastHash = entries[entries.length - 1].hash;

    // Create a new persistence instance (simulating process restart)
    const resumed = new AuditPersistence(tmpDir);
    const e3 = makeEntry({ taskId: "c" });
    resumed.append(e3);

    expect(e3.previousHash).toBe(lastHash);

    // Full chain should still verify
    const result = resumed.verify();
    expect(result.valid).toBe(true);
  });
});

describe("computeAuditHash", () => {
  it("produces consistent hashes for same input", () => {
    const entry = makeEntry();
    const h1 = computeAuditHash(entry, "GENESIS");
    const h2 = computeAuditHash(entry, "GENESIS");
    expect(h1).toBe(h2);
  });

  it("produces different hashes for different previousHash", () => {
    const entry = makeEntry();
    const h1 = computeAuditHash(entry, "GENESIS");
    const h2 = computeAuditHash(entry, "different");
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes for different entry content", () => {
    const e1 = makeEntry({ taskId: "a" });
    const e2 = makeEntry({ taskId: "b" });
    expect(computeAuditHash(e1, "GENESIS")).not.toBe(computeAuditHash(e2, "GENESIS"));
  });
});
