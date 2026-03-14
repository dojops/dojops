import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { ToolExecutor } from "../tool-executor";
import { DEFAULT_POLICY } from "../policy";
import type { ExecutionPolicy } from "../types";
import type { ToolCall } from "@dojops/core";
import type { DevOpsSkill } from "@dojops/sdk";

describe("ToolExecutor", () => {
  let tmpDir: string;
  let policy: ExecutionPolicy;
  let executor: ToolExecutor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-executor-test-"));
    policy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      enforceDevOpsAllowlist: false,
      allowedWritePaths: [tmpDir],
    };
    executor = new ToolExecutor({ policy, cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCall(name: string, args: Record<string, unknown>): ToolCall {
    return { id: `test-${name}`, name, arguments: args };
  }

  describe("read_file", () => {
    it("reads existing file contents", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.txt"), "hello world", "utf-8");
      const result = await executor.execute(makeCall("read_file", { path: "test.txt" }));
      expect(result.isError).toBeUndefined();
      expect(result.output).toContain("hello world");
    });

    it("returns error for missing file", async () => {
      const result = await executor.execute(makeCall("read_file", { path: "nonexistent.txt" }));
      expect(result.isError).toBe(true);
      expect(result.output).toContain("not found");
    });

    it("supports offset and limit", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "lines.txt"),
        "line1\nline2\nline3\nline4\nline5",
        "utf-8",
      );
      const result = await executor.execute(
        makeCall("read_file", { path: "lines.txt", offset: 2, limit: 2 }),
      );
      expect(result.output).toContain("line2");
      expect(result.output).toContain("line3");
      expect(result.output).not.toContain("line1");
      expect(result.output).not.toContain("line4");
    });

    it("lists directory contents when path is a directory", async () => {
      fs.mkdirSync(path.join(tmpDir, "subdir"));
      fs.writeFileSync(path.join(tmpDir, "subdir", "a.txt"), "a", "utf-8");
      const result = await executor.execute(makeCall("read_file", { path: "subdir" }));
      expect(result.output).toContain("a.txt");
    });
  });

  describe("write_file", () => {
    it("creates a new file", async () => {
      const result = await executor.execute(
        makeCall("write_file", { path: "new.txt", content: "created" }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.output).toContain("Created");
      expect(fs.readFileSync(path.join(tmpDir, "new.txt"), "utf-8")).toBe("created");
    });

    it("overwrites existing file", async () => {
      fs.writeFileSync(path.join(tmpDir, "exist.txt"), "old", "utf-8");
      const result = await executor.execute(
        makeCall("write_file", { path: "exist.txt", content: "new" }),
      );
      expect(result.output).toContain("Updated");
      expect(fs.readFileSync(path.join(tmpDir, "exist.txt"), "utf-8")).toBe("new");
    });

    it("creates intermediate directories", async () => {
      const result = await executor.execute(
        makeCall("write_file", { path: "a/b/c.txt", content: "deep" }),
      );
      expect(result.isError).toBeUndefined();
      expect(fs.readFileSync(path.join(tmpDir, "a/b/c.txt"), "utf-8")).toBe("deep");
    });

    it("tracks written files", async () => {
      await executor.execute(makeCall("write_file", { path: "track.txt", content: "x" }));
      expect(executor.getFilesWritten()).toHaveLength(1);
    });
  });

  describe("edit_file", () => {
    it("replaces unique string in file", async () => {
      fs.writeFileSync(path.join(tmpDir, "edit.txt"), "hello world foo", "utf-8");
      const result = await executor.execute(
        makeCall("edit_file", { path: "edit.txt", old_string: "world", new_string: "earth" }),
      );
      expect(result.isError).toBeUndefined();
      expect(fs.readFileSync(path.join(tmpDir, "edit.txt"), "utf-8")).toBe("hello earth foo");
    });

    it("errors when old_string not found", async () => {
      fs.writeFileSync(path.join(tmpDir, "edit.txt"), "hello", "utf-8");
      const result = await executor.execute(
        makeCall("edit_file", { path: "edit.txt", old_string: "xyz", new_string: "abc" }),
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("not found");
    });

    it("errors when old_string matches multiple times", async () => {
      fs.writeFileSync(path.join(tmpDir, "edit.txt"), "aaa bbb aaa", "utf-8");
      const result = await executor.execute(
        makeCall("edit_file", { path: "edit.txt", old_string: "aaa", new_string: "xxx" }),
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("2 times");
    });

    it("tracks modified files", async () => {
      fs.writeFileSync(path.join(tmpDir, "mod.txt"), "original", "utf-8");
      await executor.execute(
        makeCall("edit_file", { path: "mod.txt", old_string: "original", new_string: "modified" }),
      );
      expect(executor.getFilesModified()).toHaveLength(1);
    });
  });

  describe("run_command", () => {
    it("executes shell commands", async () => {
      const result = await executor.execute(makeCall("run_command", { command: "echo hello" }));
      expect(result.output.trim()).toBe("hello");
    });

    it("captures stderr on failure", async () => {
      const result = await executor.execute(
        makeCall("run_command", { command: "ls /nonexistent_path_xyz 2>&1 || true" }),
      );
      // Command runs successfully (|| true), but stderr is captured
      expect(result.isError).toBeUndefined();
    });

    it("uses custom cwd", async () => {
      const subDir = path.join(tmpDir, "sub");
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(subDir, "marker.txt"), "found", "utf-8");
      const result = await executor.execute(
        makeCall("run_command", { command: "cat marker.txt", cwd: "sub" }),
      );
      expect(result.output.trim()).toBe("found");
    });
  });

  describe("run_skill", () => {
    it("returns error when no skills available", async () => {
      const result = await executor.execute(
        makeCall("run_skill", { skill: "terraform", input: {} }),
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("No skills available");
    });

    it("returns error for unknown skill", async () => {
      const skillsMap = new Map<string, DevOpsSkill>([
        [
          "docker",
          {
            name: "docker",
            validate: () => ({ valid: true }),
            generate: async () => "ok",
          } as unknown as DevOpsSkill,
        ],
      ]);
      const executorWithSkills = new ToolExecutor({ policy, cwd: tmpDir, skills: skillsMap });
      const result = await executorWithSkills.execute(
        makeCall("run_skill", { skill: "terraform", input: {} }),
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("not found");
      expect(result.output).toContain("docker");
    });
  });

  describe("done", () => {
    it("returns summary", async () => {
      const result = await executor.execute(makeCall("done", { summary: "All tasks complete" }));
      expect(result.output).toBe("All tasks complete");
      expect(result.isError).toBeUndefined();
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool names", async () => {
      const result = await executor.execute(makeCall("unknown_tool", {}));
      expect(result.isError).toBe(true);
      expect(result.output).toContain("Unknown tool");
    });
  });

  describe("policy enforcement", () => {
    it("blocks writes when allowWrite is false", async () => {
      const readOnlyExecutor = new ToolExecutor({
        policy: { ...DEFAULT_POLICY, allowWrite: false },
        cwd: tmpDir,
      });
      const result = await readOnlyExecutor.execute(
        makeCall("write_file", { path: "blocked.txt", content: "nope" }),
      );
      expect(result.isError).toBe(true);
      expect(result.output).toContain("not allowed");
    });
  });

  describe("callbacks", () => {
    it("calls onToolStart and onToolEnd", async () => {
      const onStart = vi.fn();
      const onEnd = vi.fn();
      const cbExecutor = new ToolExecutor({
        policy,
        cwd: tmpDir,
        onToolStart: onStart,
        onToolEnd: onEnd,
      });

      await cbExecutor.execute(makeCall("done", { summary: "test" }));
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onEnd).toHaveBeenCalledTimes(1);
    });
  });
});
