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
  findProjectRoot,
  PlanState,
  SessionState,
} from "./state";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oda-state-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates .oda directory structure", () => {
    const created = initProject(tmpDir);
    expect(created.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(tmpDir, ".oda"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".oda", "plans"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".oda", "history"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".oda", "execution-logs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".oda", "session.json"))).toBe(true);
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

describe("findProjectRoot", () => {
  it("finds .oda directory", () => {
    initProject(tmpDir);
    const subDir = path.join(tmpDir, "sub", "deep");
    fs.mkdirSync(subDir, { recursive: true });
    const root = findProjectRoot(subDir);
    expect(root).toBe(tmpDir);
  });
});
