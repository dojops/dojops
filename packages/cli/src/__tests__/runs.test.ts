import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  writeRunMeta,
  readRunMeta,
  writeRunResult,
  readRunResult,
  listRuns,
  cleanOldRuns,
  updateRunStatus,
  runsDir,
  RunMeta,
  RunResult,
} from "../runs";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-runs-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeMeta(overrides: Partial<RunMeta> = {}): RunMeta {
  return {
    id: "test-run-id-1234",
    prompt: "Create a Dockerfile",
    status: "running",
    pid: 12345,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("runs", () => {
  describe("writeRunMeta / readRunMeta", () => {
    it("writes and reads run metadata", () => {
      const meta = makeMeta();
      writeRunMeta(tmpDir, meta);
      const read = readRunMeta(tmpDir, meta.id);

      expect(read).not.toBeNull();
      expect(read!.id).toBe(meta.id);
      expect(read!.prompt).toBe(meta.prompt);
      expect(read!.status).toBe("running");
      expect(read!.pid).toBe(12345);
    });

    it("returns null for non-existent run", () => {
      const read = readRunMeta(tmpDir, "nonexistent");
      expect(read).toBeNull();
    });
  });

  describe("writeRunResult / readRunResult", () => {
    it("writes and reads run result", () => {
      const meta = makeMeta();
      writeRunMeta(tmpDir, meta);

      const result: RunResult = {
        success: true,
        summary: "Created Dockerfile successfully",
        iterations: 5,
        toolCalls: 3,
        totalTokens: 1500,
        filesWritten: ["Dockerfile"],
        filesModified: [],
      };
      writeRunResult(tmpDir, meta.id, result);

      const read = readRunResult(tmpDir, meta.id);
      expect(read).not.toBeNull();
      expect(read!.success).toBe(true);
      expect(read!.summary).toBe("Created Dockerfile successfully");
      expect(read!.iterations).toBe(5);
    });

    it("returns null for non-existent result", () => {
      const read = readRunResult(tmpDir, "nonexistent");
      expect(read).toBeNull();
    });
  });

  describe("updateRunStatus", () => {
    it("updates status and sets completedAt", () => {
      const meta = makeMeta();
      writeRunMeta(tmpDir, meta);

      updateRunStatus(tmpDir, meta.id, "completed");

      const updated = readRunMeta(tmpDir, meta.id);
      expect(updated!.status).toBe("completed");
      expect(updated!.completedAt).toBeDefined();
    });
  });

  describe("listRuns", () => {
    it("lists all runs sorted by date descending", () => {
      const meta1 = makeMeta({
        id: "run-1",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        completedAt: "2026-01-01T00:01:00.000Z",
      });
      const meta2 = makeMeta({
        id: "run-2",
        startedAt: "2026-01-02T00:00:00.000Z",
        status: "completed",
        completedAt: "2026-01-02T00:01:00.000Z",
      });

      writeRunMeta(tmpDir, meta1);
      writeRunMeta(tmpDir, meta2);

      const runs = listRuns(tmpDir);
      expect(runs).toHaveLength(2);
      // Most recent first
      expect(runs[0].id).toBe("run-2");
      expect(runs[1].id).toBe("run-1");
    });

    it("returns empty array when no runs directory exists", () => {
      const emptyDir = path.join(tmpDir, "empty-project");
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(listRuns(emptyDir)).toHaveLength(0);
    });
  });

  describe("cleanOldRuns", () => {
    it("removes completed runs older than maxAgeDays", () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const meta = makeMeta({
        id: "old-run",
        status: "completed",
        startedAt: oldDate,
        completedAt: oldDate,
      });
      writeRunMeta(tmpDir, meta);

      const removed = cleanOldRuns(tmpDir, 7);
      expect(removed).toBe(1);

      // Verify directory was removed
      expect(fs.existsSync(path.join(runsDir(tmpDir), "old-run"))).toBe(false);
    });

    it("preserves recent completed runs", () => {
      const meta = makeMeta({
        id: "recent-run",
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      writeRunMeta(tmpDir, meta);

      const removed = cleanOldRuns(tmpDir, 7);
      expect(removed).toBe(0);
    });

    it("never removes running runs regardless of age", () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      // Use current process PID so the "alive" check passes
      const meta = makeMeta({
        id: "still-running",
        status: "running",
        startedAt: oldDate,
        pid: process.pid,
      });
      writeRunMeta(tmpDir, meta);

      const removed = cleanOldRuns(tmpDir, 7);
      expect(removed).toBe(0); // Running runs are never cleaned

      const runs = listRuns(tmpDir);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("running");
    });
  });
});
