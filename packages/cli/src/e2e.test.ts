import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  initProject,
  savePlan,
  appendAudit,
  verifyAuditIntegrity,
  PlanState,
  AuditEntry,
} from "./state";

const CLI_BIN = path.resolve(__dirname, "..", "dist", "index.js");
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;

function run(args: string, opts?: { cwd?: string; env?: Record<string, string> }): string {
  const env = { ...process.env, NO_COLOR: "1", ...opts?.env };
  return execSync(`node ${CLI_BIN} ${args}`, {
    cwd: opts?.cwd,
    env,
    encoding: "utf-8",
    timeout: 60_000,
  });
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-e2e-"));
}

function seedPlan(tmpDir: string): PlanState {
  initProject(tmpDir);
  const plan: PlanState = {
    id: "plan-test1234",
    goal: "Create CI for Node.js app",
    createdAt: new Date().toISOString(),
    risk: "LOW",
    tasks: [
      {
        id: "task-1",
        tool: "github-actions",
        description: "Generate GitHub Actions workflow",
        dependsOn: [],
      },
      {
        id: "task-2",
        tool: "terraform",
        description: "Generate Terraform config",
        dependsOn: ["task-1"],
      },
    ],
    files: [],
    approvalStatus: "PENDING",
  };
  savePlan(tmpDir, plan);
  return plan;
}

function seedAudit(tmpDir: string, planId: string): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    user: process.env.USER ?? "test",
    command: `plan ${planId}`,
    action: "plan",
    planId,
    status: "success",
    durationMs: 1234,
  };
  appendAudit(tmpDir, entry);
}

// ── LLM-free tests (always run) ─────────────────────────────────────

describe("CLI E2E — LLM-free", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dojops init creates .dojops/ structure", () => {
    const output = run("init", { cwd: tmpDir });
    expect(output).toContain(".dojops");
    expect(fs.existsSync(path.join(tmpDir, ".dojops"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "plans"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "history"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "session.json"))).toBe(true);
  });

  it("dojops validate on a seeded plan succeeds", () => {
    const plan = seedPlan(tmpDir);
    const output = run(`validate ${plan.id}`, { cwd: tmpDir });
    expect(output.toLowerCase()).not.toContain("error");
  });

  it("dojops validate on a plan with circular deps detects errors", () => {
    initProject(tmpDir);
    const plan: PlanState = {
      id: "plan-circular",
      goal: "Test circular",
      createdAt: new Date().toISOString(),
      risk: "LOW",
      tasks: [
        { id: "t1", tool: "terraform", description: "Task 1", dependsOn: ["t2"] },
        { id: "t2", tool: "terraform", description: "Task 2", dependsOn: ["t1"] },
      ],
      files: [],
      approvalStatus: "PENDING",
    };
    savePlan(tmpDir, plan);

    let output: string;
    try {
      output = run(`validate ${plan.id}`, { cwd: tmpDir });
    } catch (e: unknown) {
      // validate may exit non-zero for invalid plans
      output = (e as { stdout?: string }).stdout ?? "";
    }
    // Should mention circular or cycle or dependency issue
    const lower = output.toLowerCase();
    expect(lower.includes("circular") || lower.includes("cycle") || lower.includes("depend")).toBe(
      true,
    );
  });

  it("dojops apply --dry-run shows plan without executing", () => {
    seedPlan(tmpDir);
    const output = run("apply --dry-run", { cwd: tmpDir });
    const lower = output.toLowerCase();
    expect(lower.includes("dry") || lower.includes("plan") || lower.includes("task")).toBe(true);
  });

  it("dojops history list shows seeded plans", () => {
    const plan = seedPlan(tmpDir);
    seedAudit(tmpDir, plan.id);
    const output = run("history list", { cwd: tmpDir });
    expect(output).toContain(plan.id);
  });

  it("dojops history show <plan-id> shows plan details", () => {
    const plan = seedPlan(tmpDir);
    const output = run(`history show ${plan.id}`, { cwd: tmpDir });
    expect(output).toContain(plan.id);
    expect(output).toContain(plan.goal);
  });

  it("audit integrity verification passes on valid audit log", () => {
    const plan = seedPlan(tmpDir);
    seedAudit(tmpDir, plan.id);
    const result = verifyAuditIntegrity(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

// ── LLM-dependent tests (skip when no API key) ──────────────────────

describe.skipIf(!HAS_KEY)("CLI E2E — with Anthropic", () => {
  let tmpDir: string;

  const llmEnv = {
    DOJOPS_PROVIDER: "anthropic",
    DOJOPS_MODEL: "claude-haiku-4-5-20251001",
  };

  beforeEach(() => {
    tmpDir = makeTmpDir();
    // Init the project first
    run("init", { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dojops plan produces a plan file in .dojops/plans/", async () => {
    run('plan --quiet --non-interactive "Create a GitHub Actions CI for Node.js"', {
      cwd: tmpDir,
      env: llmEnv,
    });
    const plansDir = path.join(tmpDir, ".dojops", "plans");
    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    const plan = JSON.parse(fs.readFileSync(path.join(plansDir, files[0]), "utf-8")) as PlanState;
    expect(plan.goal).toBeTruthy();
    expect(Array.isArray(plan.tasks)).toBe(true);
    expect(plan.tasks.length).toBeGreaterThan(0);
  }, 60_000);

  it("dojops plan --output json returns valid JSON", async () => {
    const output = run(
      'plan --quiet --non-interactive --output json "Create CI for a Python project"',
      { cwd: tmpDir, env: llmEnv },
    );
    // The JSON output should be parseable
    const parsed = JSON.parse(output);
    expect(parsed).toBeDefined();
    expect(parsed.tasks || parsed.graph || parsed.id).toBeDefined();
  }, 60_000);

  it("full lifecycle: init → plan → validate → apply --dry-run → history list → destroy --dry-run", async () => {
    // Plan
    run('plan --quiet --non-interactive "Create a simple Terraform S3 bucket config"', {
      cwd: tmpDir,
      env: llmEnv,
    });

    // Find the plan
    const plansDir = path.join(tmpDir, ".dojops", "plans");
    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const planId = files[0].replace(".json", "");

    // Validate
    const valOut = run(`validate ${planId}`, { cwd: tmpDir });
    expect(valOut.toLowerCase()).not.toContain("error");

    // Apply --dry-run
    const applyOut = run(`apply --dry-run ${planId}`, { cwd: tmpDir });
    const applyLower = applyOut.toLowerCase();
    expect(
      applyLower.includes("dry") || applyLower.includes("plan") || applyLower.includes("task"),
    ).toBe(true);

    // History list
    const histOut = run("history list", { cwd: tmpDir });
    expect(histOut).toContain(planId);

    // Destroy --dry-run
    const destroyOut = run(`destroy --dry-run ${planId}`, { cwd: tmpDir });
    expect(destroyOut.toLowerCase()).not.toContain("fatal");
  }, 90_000);
});
