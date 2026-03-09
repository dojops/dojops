import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initProject } from "../state";
import {
  openMemoryDb,
  closeMemoryDb,
  recordTask,
  queryMemory,
  buildMemoryContextString,
} from "../memory";
import type { TaskRecord } from "../memory";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-memory-"));
  initProject(tmpDir);
});

afterEach(() => {
  closeMemoryDb(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("openMemoryDb", () => {
  it("creates the database file", () => {
    const db = openMemoryDb(tmpDir);
    expect(db).not.toBeNull();
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "memory", "dojops.db"))).toBe(true);
  });

  it("is idempotent — returns same instance", () => {
    const db1 = openMemoryDb(tmpDir);
    const db2 = openMemoryDb(tmpDir);
    expect(db1).toBe(db2);
  });
});

describe("recordTask", () => {
  it("inserts a task record", () => {
    recordTask(tmpDir, {
      timestamp: "2025-03-08T10:00:00Z",
      task_type: "generate",
      prompt: "Create a Dockerfile",
      result_summary: "Generated Dockerfile for Node.js app",
      status: "success",
      duration_ms: 1500,
      related_files: '["Dockerfile"]',
      agent_or_module: "docker",
      metadata: "{}",
    });

    const db = openMemoryDb(tmpDir)!;
    const rows = db.prepare("SELECT * FROM tasks_history").all() as TaskRecord[];
    expect(rows).toHaveLength(1);
    expect(rows[0].prompt).toBe("Create a Dockerfile");
    expect(rows[0].task_type).toBe("generate");
    expect(rows[0].status).toBe("success");
    expect(rows[0].agent_or_module).toBe("docker");
  });

  it("does not throw on repeated inserts", () => {
    for (let i = 0; i < 5; i++) {
      recordTask(tmpDir, {
        timestamp: new Date().toISOString(),
        task_type: "scan",
        prompt: "",
        result_summary: `Scan ${i}`,
        status: "success",
        duration_ms: 100,
        related_files: "[]",
        agent_or_module: "",
        metadata: "{}",
      });
    }
    const db = openMemoryDb(tmpDir)!;
    const count = (db.prepare("SELECT COUNT(*) as cnt FROM tasks_history").get() as { cnt: number })
      .cnt;
    expect(count).toBe(5);
  });
});

function insertTasks(tasks: Array<Partial<Omit<TaskRecord, "id">>>): void {
  for (const t of tasks) {
    recordTask(tmpDir, {
      timestamp: t.timestamp ?? new Date().toISOString(),
      task_type: (t.task_type ?? "generate") as TaskRecord["task_type"],
      prompt: t.prompt ?? "",
      result_summary: t.result_summary ?? "",
      status: (t.status ?? "success") as TaskRecord["status"],
      duration_ms: t.duration_ms ?? 0,
      related_files: t.related_files ?? "[]",
      agent_or_module: t.agent_or_module ?? "",
      metadata: t.metadata ?? "{}",
    });
  }
}

describe("queryMemory", () => {
  it("returns empty context when no tasks exist", () => {
    const ctx = queryMemory(tmpDir, "generate", "something");
    expect(ctx.recentTasks).toHaveLength(0);
    expect(ctx.relatedTasks).toHaveLength(0);
    expect(ctx.isContinuation).toBe(false);
  });

  it("returns recent tasks ordered by timestamp desc", () => {
    insertTasks([
      { timestamp: "2025-03-01T10:00:00Z", prompt: "first" },
      { timestamp: "2025-03-02T10:00:00Z", prompt: "second" },
      { timestamp: "2025-03-03T10:00:00Z", prompt: "third" },
    ]);

    const ctx = queryMemory(tmpDir, "generate", "unrelated");
    expect(ctx.recentTasks).toHaveLength(3);
    expect(ctx.recentTasks[0].prompt).toBe("third");
    expect(ctx.recentTasks[2].prompt).toBe("first");
  });

  it("filters related tasks by task_type", () => {
    insertTasks([
      { task_type: "generate", prompt: "gen1" },
      { task_type: "scan", prompt: "" },
      { task_type: "generate", prompt: "gen2" },
      { task_type: "plan", prompt: "plan1" },
    ]);

    const ctx = queryMemory(tmpDir, "generate", "something");
    expect(ctx.relatedTasks).toHaveLength(2);
    expect(ctx.relatedTasks.every((t) => t.task_type === "generate")).toBe(true);
  });

  it("detects continuation when prompts overlap", () => {
    const recent = new Date().toISOString();
    insertTasks([
      {
        timestamp: recent,
        task_type: "generate",
        prompt: "Create Terraform config for AWS S3 bucket",
        status: "success",
      },
    ]);

    const ctx = queryMemory(tmpDir, "generate", "Update Terraform config for AWS S3 versioning");
    expect(ctx.isContinuation).toBe(true);
    expect(ctx.continuationOf).toBeDefined();
    expect(ctx.continuationOf!.prompt).toContain("Terraform config for AWS S3");
  });

  it("does not detect continuation for unrelated prompts", () => {
    const recent = new Date().toISOString();
    insertTasks([
      {
        timestamp: recent,
        task_type: "generate",
        prompt: "Create Terraform config for AWS S3 bucket",
        status: "success",
      },
    ]);

    const ctx = queryMemory(tmpDir, "generate", "Set up GitHub Actions CI pipeline");
    expect(ctx.isContinuation).toBe(false);
  });

  it("does not detect continuation for old tasks outside the window", () => {
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    insertTasks([
      {
        timestamp: oldDate,
        task_type: "generate",
        prompt: "Create Terraform config for AWS S3 bucket",
        status: "success",
      },
    ]);

    const ctx = queryMemory(tmpDir, "generate", "Update Terraform config for AWS S3 versioning");
    expect(ctx.isContinuation).toBe(false);
  });

  it("does not detect continuation across different task types", () => {
    const recent = new Date().toISOString();
    insertTasks([
      {
        timestamp: recent,
        task_type: "plan",
        prompt: "Create Terraform config for AWS S3 bucket",
        status: "success",
      },
    ]);

    const ctx = queryMemory(tmpDir, "generate", "Create Terraform config for AWS S3 bucket");
    expect(ctx.isContinuation).toBe(false);
  });
});

describe("buildMemoryContextString", () => {
  it("returns null for empty history", () => {
    const result = buildMemoryContextString({
      recentTasks: [],
      relatedTasks: [],
      isContinuation: false,
    });
    expect(result).toBeNull();
  });

  it("includes continuation notice when continuing previous work", () => {
    const result = buildMemoryContextString({
      recentTasks: [
        {
          id: 1,
          timestamp: "2025-03-08T10:00:00Z",
          task_type: "generate",
          prompt: "Create Terraform config",
          result_summary: "Generated",
          status: "success",
          duration_ms: 1000,
          related_files: "[]",
          agent_or_module: "terraform",
          metadata: "{}",
        },
      ],
      relatedTasks: [],
      isContinuation: true,
      continuationOf: {
        id: 1,
        timestamp: "2025-03-08T10:00:00Z",
        task_type: "generate",
        prompt: "Create Terraform config",
        result_summary: "Generated",
        status: "success",
        duration_ms: 1000,
        related_files: "[]",
        agent_or_module: "terraform",
        metadata: "{}",
      },
    });
    expect(result).toContain("Continuing previous work");
    expect(result).toContain("Create Terraform config");
  });

  it("shows recent activity without continuation", () => {
    const result = buildMemoryContextString({
      recentTasks: [
        {
          id: 1,
          timestamp: "2025-03-08T10:00:00Z",
          task_type: "scan",
          prompt: "",
          result_summary: "3 findings",
          status: "success",
          duration_ms: 5000,
          related_files: "[]",
          agent_or_module: "npm-audit",
          metadata: "{}",
        },
      ],
      relatedTasks: [],
      isContinuation: false,
    });
    expect(result).toContain("Recent successful operations");
    expect(result).toContain("3 findings");
    expect(result).toContain("npm-audit");
  });

  it("respects character budget", () => {
    const tasks: TaskRecord[] = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      timestamp: `2025-03-08T${String(i).padStart(2, "0")}:00:00Z`,
      task_type: "generate" as const,
      prompt: "A very long prompt that takes up a lot of characters in the output string",
      result_summary: "Done",
      status: "success" as const,
      duration_ms: 1000,
      related_files: "[]",
      agent_or_module: "some-agent",
      metadata: "{}",
    }));
    const result = buildMemoryContextString({
      recentTasks: tasks,
      relatedTasks: [],
      isContinuation: false,
    });
    expect(result).not.toBeNull();
    // Budget is MAX_CONTEXT_CHARS (1200) for task lines, plus footer
    expect(result!.length).toBeLessThanOrEqual(1400);
  });
});
