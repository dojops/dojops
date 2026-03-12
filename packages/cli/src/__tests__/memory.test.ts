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
  addNote,
  listNotes,
  removeNote,
  searchNotes,
  recordError,
  listErrorPatterns,
  resolveError,
  removeErrorPattern,
  errorFingerprint,
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
      relevantNotes: [],
      errorWarnings: [],
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
      relevantNotes: [],
      errorWarnings: [],
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
      relevantNotes: [],
      errorWarnings: [],
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
      relevantNotes: [],
      errorWarnings: [],
    });
    expect(result).not.toBeNull();
    // Budget is MAX_CONTEXT_CHARS (1200) for task lines, plus footer
    expect(result!.length).toBeLessThanOrEqual(1400);
  });
});

// ── Notes CRUD ──────────────────────────────────────────────────────

describe("addNote", () => {
  it("inserts a note and returns its ID", () => {
    const id = addNote(tmpDir, "Always use us-east-1", "terraform");
    expect(id).toBeGreaterThan(0);
  });

  it("uses 'general' category by default", () => {
    const id = addNote(tmpDir, "Some general note");
    const notes = listNotes(tmpDir);
    expect(notes.find((n) => n.id === id)?.category).toBe("general");
  });
});

describe("listNotes", () => {
  it("returns all notes ordered by ID descending", () => {
    addNote(tmpDir, "First note");
    addNote(tmpDir, "Second note");
    const notes = listNotes(tmpDir);
    expect(notes).toHaveLength(2);
    expect(notes[0].content).toBe("Second note");
    expect(notes[1].content).toBe("First note");
  });

  it("filters by category", () => {
    addNote(tmpDir, "Terraform rule", "terraform");
    addNote(tmpDir, "CI rule", "ci");
    addNote(tmpDir, "Another terraform", "terraform");
    const tfNotes = listNotes(tmpDir, "terraform");
    expect(tfNotes).toHaveLength(2);
    expect(tfNotes.every((n) => n.category === "terraform")).toBe(true);
  });

  it("returns empty array when no notes", () => {
    expect(listNotes(tmpDir)).toEqual([]);
  });
});

describe("removeNote", () => {
  it("deletes a note by ID", () => {
    const id = addNote(tmpDir, "To be deleted");
    expect(removeNote(tmpDir, id)).toBe(true);
    expect(listNotes(tmpDir)).toHaveLength(0);
  });

  it("returns false for non-existent ID", () => {
    expect(removeNote(tmpDir, 999)).toBe(false);
  });
});

describe("searchNotes", () => {
  it("finds notes by content match", () => {
    addNote(tmpDir, "Always deploy to us-east-1 for Terraform");
    addNote(tmpDir, "CI must run on Node 20");
    const results = searchNotes(tmpDir, "terraform deploy");
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Terraform");
  });

  it("finds notes by keywords field", () => {
    addNote(tmpDir, "Use strict mode", "general", "typescript strict");
    const results = searchNotes(tmpDir, "typescript");
    expect(results).toHaveLength(1);
  });

  it("returns empty for no match", () => {
    addNote(tmpDir, "Some note");
    expect(searchNotes(tmpDir, "nonexistent")).toEqual([]);
  });
});

describe("buildMemoryContextString with notes", () => {
  it("includes relevant notes in context", () => {
    const result = buildMemoryContextString({
      recentTasks: [
        {
          id: 1,
          timestamp: "2025-03-08T10:00:00Z",
          task_type: "generate",
          prompt: "Create CI",
          result_summary: "Done",
          status: "success",
          duration_ms: 100,
          related_files: "[]",
          agent_or_module: "",
          metadata: "{}",
        },
      ],
      relatedTasks: [],
      isContinuation: false,
      relevantNotes: [
        {
          id: 1,
          timestamp: "2025-03-08T10:00:00Z",
          category: "ci",
          content: "CI must use Node 20 only",
          keywords: "ci node",
        },
      ],
      errorWarnings: [],
    });
    expect(result).toContain("Project notes:");
    expect(result).toContain("CI must use Node 20 only");
    expect(result).toContain("[ci]");
  });
});

// ── Error Pattern Learning ──────────────────────────────────────────

describe("errorFingerprint", () => {
  it("normalizes variable parts for stable grouping", () => {
    const fp1 = errorFingerprint("ENOENT /home/user/file.ts", "generate", "terraform");
    const fp2 = errorFingerprint("ENOENT /tmp/other/path.ts", "generate", "terraform");
    expect(fp1).toBe(fp2);
  });

  it("differentiates by task type and module", () => {
    const fp1 = errorFingerprint("timeout", "generate", "terraform");
    const fp2 = errorFingerprint("timeout", "apply", "terraform");
    expect(fp1).not.toBe(fp2);
  });
});

describe("recordError", () => {
  it("records a new error pattern", () => {
    recordError(tmpDir, "ENOENT: file not found", "generate", "terraform");
    const patterns = listErrorPatterns(tmpDir);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(1);
    expect(patterns[0].task_type).toBe("generate");
  });

  it("increments count on duplicate fingerprint", () => {
    recordError(tmpDir, "ENOENT: file not found", "generate", "terraform");
    recordError(tmpDir, "ENOENT: file not found", "generate", "terraform");
    recordError(tmpDir, "ENOENT: file not found", "generate", "terraform");
    const patterns = listErrorPatterns(tmpDir);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrences).toBe(3);
  });
});

describe("resolveError", () => {
  it("marks an error as resolved", () => {
    recordError(tmpDir, "timeout error", "apply", "");
    const patterns = listErrorPatterns(tmpDir);
    const id = patterns[0].id;

    const ok = resolveError(tmpDir, id, "Increased --timeout to 120s");
    expect(ok).toBe(true);

    const updated = listErrorPatterns(tmpDir);
    expect(updated[0].resolution).toBe("Increased --timeout to 120s");
  });
});

describe("removeErrorPattern", () => {
  it("deletes an error pattern", () => {
    recordError(tmpDir, "some error", "scan", "");
    const patterns = listErrorPatterns(tmpDir);
    expect(removeErrorPattern(tmpDir, patterns[0].id)).toBe(true);
    expect(listErrorPatterns(tmpDir)).toHaveLength(0);
  });
});

describe("recordTask auto-learns errors", () => {
  it("records error pattern when task status is failure", () => {
    recordTask(tmpDir, {
      timestamp: new Date().toISOString(),
      task_type: "generate",
      prompt: "Create Dockerfile",
      result_summary: "LLM provider returned 429 rate limit",
      status: "failure",
      duration_ms: 500,
      related_files: "[]",
      agent_or_module: "dockerfile",
      metadata: "{}",
    });
    const patterns = listErrorPatterns(tmpDir);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].error_message).toContain("rate limit");
  });

  it("does not record error pattern on success", () => {
    recordTask(tmpDir, {
      timestamp: new Date().toISOString(),
      task_type: "generate",
      prompt: "Create Dockerfile",
      result_summary: "Generated Dockerfile",
      status: "success",
      duration_ms: 500,
      related_files: "[]",
      agent_or_module: "dockerfile",
      metadata: "{}",
    });
    expect(listErrorPatterns(tmpDir)).toHaveLength(0);
  });
});

describe("buildMemoryContextString with error warnings", () => {
  it("includes error warnings in context", () => {
    const result = buildMemoryContextString({
      recentTasks: [
        {
          id: 1,
          timestamp: "2025-03-08T10:00:00Z",
          task_type: "generate",
          prompt: "Create CI",
          result_summary: "Done",
          status: "success",
          duration_ms: 100,
          related_files: "[]",
          agent_or_module: "",
          metadata: "{}",
        },
      ],
      relatedTasks: [],
      isContinuation: false,
      relevantNotes: [],
      errorWarnings: [
        {
          id: 1,
          fingerprint: "generate::timeout",
          error_message: "LLM request timed out after 60s",
          task_type: "generate",
          agent_or_module: "",
          occurrences: 3,
          first_seen: "2025-03-07T10:00:00Z",
          last_seen: "2025-03-08T10:00:00Z",
          resolution: "",
        },
      ],
    });
    expect(result).toContain("Known error patterns");
    expect(result).toContain("LLM request timed out");
    expect(result).toContain("3x");
  });
});
