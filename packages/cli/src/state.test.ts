import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  initProject,
  loadSession,
  saveSession,
  savePlan,
  loadPlan,
  listPlans,
  getLatestPlan,
  generatePlanId,
  saveExecution,
  listExecutions,
  appendAudit,
  readAudit,
  verifyAuditIntegrity,
  findProjectRoot,
  acquireLock,
  releaseLock,
  isLocked,
  PlanState,
  SessionState,
} from "./state";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-state-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates .dojops directory structure", () => {
    const created = initProject(tmpDir);
    expect(created.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, ".dojops"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "plans"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "history"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "execution-logs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "session.json"))).toBe(true);
  });

  it("is idempotent", () => {
    initProject(tmpDir);
    const second = initProject(tmpDir);
    expect(second.length).toBe(0);
  });
});

describe("session", () => {
  it("loads default session when none exists", () => {
    initProject(tmpDir);
    const session = loadSession(tmpDir);
    expect(session.mode).toBe("IDLE");
  });

  it("saves and loads session", () => {
    initProject(tmpDir);
    const session: SessionState = {
      mode: "PLAN",
      currentPlan: "plan-abc12345",
      riskLevel: "LOW",
      updatedAt: new Date().toISOString(),
    };
    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir);
    expect(loaded.mode).toBe("PLAN");
    expect(loaded.currentPlan).toBe("plan-abc12345");
  });
});

describe("plans", () => {
  const makePlan = (id?: string): PlanState => ({
    id: id ?? generatePlanId(),
    goal: "Test goal",
    createdAt: new Date().toISOString(),
    risk: "LOW",
    tasks: [{ id: "t1", tool: "terraform", description: "Create S3", dependsOn: [] }],
    files: [],
    approvalStatus: "PENDING",
  });

  it("generates unique plan IDs", () => {
    const id1 = generatePlanId();
    const id2 = generatePlanId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^plan-[a-f0-9]{8}$/);
  });

  it("saves and loads a plan", () => {
    initProject(tmpDir);
    const plan = makePlan("plan-test1234");
    savePlan(tmpDir, plan);
    const loaded = loadPlan(tmpDir, "plan-test1234");
    expect(loaded).not.toBeNull();
    expect(loaded!.goal).toBe("Test goal");
    expect(loaded!.tasks).toHaveLength(1);
  });

  it("returns null for missing plan", () => {
    initProject(tmpDir);
    expect(loadPlan(tmpDir, "plan-nonexist")).toBeNull();
  });

  it("lists plans sorted by date", () => {
    initProject(tmpDir);
    const p1 = makePlan("plan-00000001");
    p1.createdAt = "2024-01-01T00:00:00Z";
    const p2 = makePlan("plan-00000002");
    p2.createdAt = "2024-06-01T00:00:00Z";
    savePlan(tmpDir, p1);
    savePlan(tmpDir, p2);
    const plans = listPlans(tmpDir);
    expect(plans).toHaveLength(2);
    expect(plans[0].id).toBe("plan-00000002"); // newest first
  });

  it("getLatestPlan returns most recent", () => {
    initProject(tmpDir);
    const p1 = makePlan("plan-00000001");
    p1.createdAt = "2024-01-01T00:00:00Z";
    const p2 = makePlan("plan-00000002");
    p2.createdAt = "2024-06-01T00:00:00Z";
    savePlan(tmpDir, p1);
    savePlan(tmpDir, p2);
    expect(getLatestPlan(tmpDir)?.id).toBe("plan-00000002");
  });

  it("getLatestPlan returns null when no plans", () => {
    initProject(tmpDir);
    expect(getLatestPlan(tmpDir)).toBeNull();
  });
});

describe("execution logs", () => {
  it("saves and lists execution records", () => {
    initProject(tmpDir);
    saveExecution(tmpDir, {
      planId: "plan-test1234",
      executedAt: new Date().toISOString(),
      status: "SUCCESS",
      filesCreated: ["main.tf"],
      filesModified: [],
      durationMs: 1234,
    });
    const execs = listExecutions(tmpDir);
    expect(execs).toHaveLength(1);
    expect(execs[0].planId).toBe("plan-test1234");
  });
});

describe("audit", () => {
  it("appends and reads audit entries", () => {
    initProject(tmpDir);
    appendAudit(tmpDir, {
      timestamp: new Date().toISOString(),
      user: "test",
      command: "plan Create CI",
      action: "plan",
      planId: "plan-test1234",
      status: "success",
      durationMs: 500,
    });
    appendAudit(tmpDir, {
      timestamp: new Date().toISOString(),
      user: "test",
      command: "apply plan-test1234",
      action: "apply",
      planId: "plan-test1234",
      status: "success",
      durationMs: 1200,
    });
    const all = readAudit(tmpDir);
    expect(all).toHaveLength(2);

    const filtered = readAudit(tmpDir, { planId: "plan-test1234" });
    expect(filtered).toHaveLength(2);
  });

  it("returns empty for no audit file", () => {
    initProject(tmpDir);
    expect(readAudit(tmpDir)).toEqual([]);
  });
});

describe("execution locking", () => {
  it("acquireLock returns true on first call", () => {
    initProject(tmpDir);
    expect(acquireLock(tmpDir, "apply")).toBe(true);
    releaseLock(tmpDir);
  });

  it("acquireLock returns false when already locked", () => {
    initProject(tmpDir);
    expect(acquireLock(tmpDir, "apply")).toBe(true);
    // Same process holds the lock, so it's still alive
    expect(acquireLock(tmpDir, "destroy")).toBe(false);
    releaseLock(tmpDir);
  });

  it("releaseLock allows re-acquisition", () => {
    initProject(tmpDir);
    expect(acquireLock(tmpDir, "apply")).toBe(true);
    releaseLock(tmpDir);
    expect(acquireLock(tmpDir, "apply")).toBe(true);
    releaseLock(tmpDir);
  });

  it("isLocked returns false when no lock", () => {
    initProject(tmpDir);
    const status = isLocked(tmpDir);
    expect(status.locked).toBe(false);
  });

  it("isLocked returns true when locked by live process", () => {
    initProject(tmpDir);
    acquireLock(tmpDir, "apply");
    const status = isLocked(tmpDir);
    expect(status.locked).toBe(true);
    expect(status.info?.operation).toBe("apply");
    expect(status.info?.pid).toBe(process.pid);
    releaseLock(tmpDir);
  });

  it("stale lock from dead PID is auto-cleaned", () => {
    initProject(tmpDir);
    // Write a lock file with a PID that doesn't exist
    const lockFile = path.join(tmpDir, ".dojops", "lock.json");
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: 999999, operation: "apply", acquiredAt: new Date().toISOString() }),
    );
    const status = isLocked(tmpDir);
    expect(status.locked).toBe(false);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  it("acquireLock succeeds after stale lock cleanup", () => {
    initProject(tmpDir);
    // Write a stale lock
    const lockFile = path.join(tmpDir, ".dojops", "lock.json");
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: 999999, operation: "apply", acquiredAt: new Date().toISOString() }),
    );
    // Should auto-clean stale and acquire
    expect(acquireLock(tmpDir, "destroy")).toBe(true);
    releaseLock(tmpDir);
  });
});

describe("findProjectRoot", () => {
  it("finds .dojops directory", () => {
    initProject(tmpDir);
    const subDir = path.join(tmpDir, "sub", "deep");
    fs.mkdirSync(subDir, { recursive: true });
    const root = findProjectRoot(subDir);
    expect(root).toBe(tmpDir);
  });
});

describe("audit hash chain", () => {
  const makeEntry = (command: string) => ({
    timestamp: new Date().toISOString(),
    user: "test",
    command,
    action: "test",
    planId: "plan-test",
    status: "success" as const,
    durationMs: 100,
  });

  it("appends entry with seq, hash, previousHash fields", () => {
    initProject(tmpDir);
    appendAudit(tmpDir, makeEntry("cmd1"));
    const entries = readAudit(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].seq).toBe(1);
    expect(entries[0].hash).toBeDefined();
    expect(entries[0].previousHash).toBe("genesis");
  });

  it("chains hashes across entries", () => {
    initProject(tmpDir);
    appendAudit(tmpDir, makeEntry("cmd1"));
    appendAudit(tmpDir, makeEntry("cmd2"));
    const entries = readAudit(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[1].seq).toBe(2);
    expect(entries[1].previousHash).toBe(entries[0].hash);
  });

  it("verifyAuditIntegrity passes for valid chain", () => {
    initProject(tmpDir);
    appendAudit(tmpDir, makeEntry("cmd1"));
    appendAudit(tmpDir, makeEntry("cmd2"));
    appendAudit(tmpDir, makeEntry("cmd3"));
    const result = verifyAuditIntegrity(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it("verifyAuditIntegrity detects tampered entry", () => {
    initProject(tmpDir);
    appendAudit(tmpDir, makeEntry("cmd1"));
    appendAudit(tmpDir, makeEntry("cmd2"));

    // Tamper with the audit file — change command text in first entry
    const auditPath = path.join(tmpDir, ".dojops", "history", "audit.jsonl");
    const content = fs.readFileSync(auditPath, "utf-8");
    const lines = content.trimEnd().split("\n");
    const entry = JSON.parse(lines[0]);
    entry.command = "TAMPERED";
    lines[0] = JSON.stringify(entry);
    fs.writeFileSync(auditPath, lines.join("\n") + "\n");

    const result = verifyAuditIntegrity(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].reason).toContain("tampered");
  });

  it("returns valid for empty log", () => {
    initProject(tmpDir);
    const result = verifyAuditIntegrity(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(0);
  });

  it("handles legacy entries without hash fields gracefully", () => {
    initProject(tmpDir);

    // Write a legacy entry directly (no hash fields)
    const auditPath = path.join(tmpDir, ".dojops", "history", "audit.jsonl");
    const legacyEntry = {
      timestamp: new Date().toISOString(),
      user: "test",
      command: "legacy-cmd",
      action: "test",
      status: "success",
      durationMs: 50,
    };
    fs.writeFileSync(auditPath, JSON.stringify(legacyEntry) + "\n");

    // Now append a new-format entry
    appendAudit(tmpDir, makeEntry("new-cmd"));

    const result = verifyAuditIntegrity(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(2);
  });
});

describe("plan with PARTIAL status", () => {
  it("saves and loads plan with PARTIAL status and result fields", () => {
    initProject(tmpDir);
    const plan: PlanState = {
      id: "plan-partial1",
      goal: "Test partial",
      createdAt: new Date().toISOString(),
      risk: "LOW",
      tasks: [
        { id: "t1", tool: "terraform", description: "Create S3", dependsOn: [] },
        { id: "t2", tool: "terraform", description: "Create IAM", dependsOn: ["t1"] },
      ],
      results: [
        {
          taskId: "t1",
          status: "completed",
          filesCreated: ["main.tf"],
          executionStatus: "completed",
          executionApproval: "approved",
        },
        {
          taskId: "t2",
          status: "failed",
          error: "LLM provider timeout",
          executionStatus: "failed",
        },
      ],
      files: [],
      approvalStatus: "PARTIAL",
    };
    savePlan(tmpDir, plan);
    const loaded = loadPlan(tmpDir, "plan-partial1");
    expect(loaded).not.toBeNull();
    expect(loaded!.approvalStatus).toBe("PARTIAL");
    expect(loaded!.results).toHaveLength(2);
    expect(loaded!.results![0].filesCreated).toEqual(["main.tf"]);
    expect(loaded!.results![0].executionStatus).toBe("completed");
    expect(loaded!.results![1].error).toBe("LLM provider timeout");
  });
});
