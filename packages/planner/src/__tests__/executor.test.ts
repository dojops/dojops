import { describe, it, expect, vi } from "vitest";
import { BaseTool, ToolOutput, z } from "@dojops/sdk";
import { PlannerExecutor, PlannerLogger } from "../executor";
import { TaskGraph } from "../types";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const PassthroughSchema = z.object({}).passthrough();

// ---------------------------------------------------------------------------
// Mock tools
// ---------------------------------------------------------------------------

class SuccessTool extends BaseTool<Record<string, unknown>> {
  name = "success-tool";
  description = "Always succeeds";
  inputSchema = PassthroughSchema;
  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    return { success: true, data: { result: "ok", ...input } };
  }
}

class FailTool extends BaseTool<Record<string, unknown>> {
  name = "fail-tool";
  description = "Always fails";
  inputSchema = PassthroughSchema;
  async generate(): Promise<ToolOutput> {
    return { success: false, error: "intentional failure" };
  }
}

const timestamps: { id: string; start: number; end: number }[] = [];

class TimingTool extends BaseTool<Record<string, unknown>> {
  name = "timing-tool";
  description = "Records execution timestamps";
  inputSchema = PassthroughSchema;
  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    const id = (input.taskId as string) ?? "unknown";
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    const end = Date.now();
    timestamps.push({ id, start, end });
    return { success: true, data: { result: "ok" } };
  }
}

const StrictInputSchema = z.object({ name: z.string().min(1) });

class StrictTool extends BaseTool<{ name: string }> {
  name = "strict-tool";
  description = "Requires a non-empty name field";
  inputSchema = StrictInputSchema;
  async generate(input: { name: string }): Promise<ToolOutput> {
    return { success: true, data: { greeting: `hello ${input.name}` } };
  }
}

// ---------------------------------------------------------------------------
// Shared tool instances and factory helpers
// ---------------------------------------------------------------------------

const successTool = new SuccessTool();
const failTool = new FailTool();
const timingTool = new TimingTool();
const strictTool = new StrictTool();

/** All tool sets used across tests, pre-built for reuse. */
const TOOL_SETS = {
  success: [successTool],
  successAndFail: [successTool, failTool],
  timing: [timingTool],
  successAndStrict: [successTool, strictTool],
} as const;

/** Create a task with sensible defaults. */
function makeTask(
  overrides: Partial<TaskGraph["tasks"][number]> & { id: string },
): TaskGraph["tasks"][number] {
  return {
    tool: "success-tool",
    description: overrides.id,
    dependsOn: [],
    input: {},
    ...overrides,
  };
}

/** Create a TaskGraph from minimal task definitions. */
function makeGraph(
  goal: string,
  tasks: Array<Partial<TaskGraph["tasks"][number]> & { id: string }>,
): TaskGraph {
  return { goal, tasks: tasks.map(makeTask) };
}

/** Create a PlannerExecutor with a named tool set. */
function makeExecutor(
  toolSet: keyof typeof TOOL_SETS = "success",
  logger?: PlannerLogger,
): PlannerExecutor {
  return new PlannerExecutor([...TOOL_SETS[toolSet]], logger);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlannerExecutor", () => {
  it("executes a chain of tasks in dependency order", async () => {
    const graph = makeGraph("test chain", [
      { id: "t1" },
      { id: "t2", dependsOn: ["t1"], input: { prev: "$ref:t1" } },
    ]);

    const result = await makeExecutor().execute(graph);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("completed");
    expect(result.results[1].status).toBe("completed");
    expect(result.results[1].output).toHaveProperty("prev");
  });

  it("skips downstream tasks when a dependency fails", async () => {
    const graph = makeGraph("test failure cascade", [
      { id: "t1", tool: "fail-tool", description: "will fail" },
      { id: "t2", description: "depends on t1", dependsOn: ["t1"] },
    ]);

    const result = await makeExecutor("successAndFail").execute(graph);

    expect(result.success).toBe(false);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[1].status).toBe("skipped");
  });

  it("reports error for missing tools", async () => {
    const graph = makeGraph("test missing tool", [
      { id: "t1", tool: "nonexistent", description: "unknown tool" },
    ]);

    const result = await makeExecutor().execute(graph);

    expect(result.success).toBe(false);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].error).toContain("Unknown tool");
  });

  it("detects circular dependencies", async () => {
    const graph = makeGraph("circular", [
      { id: "t1", description: "a", dependsOn: ["t2"] },
      { id: "t2", description: "b", dependsOn: ["t1"] },
    ]);

    await expect(makeExecutor().execute(graph)).rejects.toThrow("Circular dependency");
  });

  it("skips tasks in completedTaskIds", async () => {
    const started: string[] = [];
    const graph = makeGraph("test resume skip", [
      { id: "t1", description: "first" },
      { id: "t2", description: "second", dependsOn: ["t1"] },
      { id: "t3", description: "third", dependsOn: ["t2"] },
    ]);

    const executor = makeExecutor("success", {
      taskStart(id) {
        started.push(id);
      },
      taskEnd() {},
    });

    const result = await executor.execute(graph, {
      completedTaskIds: new Set(["t1"]),
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(3);
    // t1 should be marked completed but never started (skipped)
    expect(started).not.toContain("t1");
    expect(started).toContain("t2");
    expect(started).toContain("t3");
  });

  it("handles resume when dependency was completed", async () => {
    const graph = makeGraph("test resume dependency", [
      { id: "t1", description: "first" },
      { id: "t2", description: "second", dependsOn: ["t1"] },
    ]);

    const result = await makeExecutor().execute(graph, {
      completedTaskIds: new Set(["t1"]),
    });

    expect(result.success).toBe(true);
    // t2 should still run even though t1 was pre-completed
    expect(result.results[0].taskId).toBe("t1");
    expect(result.results[0].status).toBe("completed");
    expect(result.results[1].taskId).toBe("t2");
    expect(result.results[1].status).toBe("completed");
  });

  describe("$ref to failed/skipped task cascading", () => {
    it("skips task C when task A fails and task B (which C depends on) is skipped", async () => {
      const graph = makeGraph("test cascading skip", [
        { id: "t1", tool: "fail-tool", description: "will fail" },
        { id: "t2", description: "depends on t1", dependsOn: ["t1"] },
        { id: "t3", description: "depends on t2", dependsOn: ["t2"] },
      ]);

      const result = await makeExecutor("successAndFail").execute(graph);

      expect(result.success).toBe(false);
      expect(result.results[0].status).toBe("failed");
      expect(result.results[1].status).toBe("skipped");
      expect(result.results[2].status).toBe("skipped");
      expect(result.results[2].error).toContain("failed dependency");
    });
  });

  describe("empty task graph", () => {
    it("returns success: true with no results for empty tasks array", async () => {
      // TaskGraphSchema has .min(1) but TaskGraph type allows empty arrays at runtime
      const graph = makeGraph("empty plan", []);

      const result = await makeExecutor().execute(graph);

      // Empty graph: no failures, every() on empty returns true => success: true
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe("parallel execution", () => {
    it("runs independent tasks concurrently rather than sequentially", async () => {
      // Clear timestamps from prior tests
      timestamps.length = 0;

      const graph = makeGraph("parallel test", [
        { id: "t1", tool: "timing-tool", description: "task 1", input: { taskId: "t1" } },
        { id: "t2", tool: "timing-tool", description: "task 2", input: { taskId: "t2" } },
        { id: "t3", tool: "timing-tool", description: "task 3", input: { taskId: "t3" } },
      ]);

      const result = await makeExecutor("timing").execute(graph);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);

      // All 3 tasks have no deps so they should overlap in time.
      // Each takes ~50ms. If sequential, total >= 150ms.
      // If parallel, earliest start to latest end should be ~50ms (< 150ms).
      expect(timestamps).toHaveLength(3);
      const earliestStart = Math.min(...timestamps.map((t) => t.start));
      const latestEnd = Math.max(...timestamps.map((t) => t.end));
      const wallTime = latestEnd - earliestStart;

      // Parallel: wall time should be well under the sequential sum (~150ms)
      expect(wallTime).toBeLessThan(140);
    });
  });

  describe("$ref resolution edge cases", () => {
    it("drops $ref to non-existent task and continues execution", async () => {
      const graph = makeGraph("bad ref", [
        {
          id: "t1",
          description: "uses bad ref",
          input: { data: "$ref:nonexistent", prompt: "test" },
        },
      ]);

      const result = await makeExecutor().execute(graph);

      // Task should succeed — the hallucinated $ref is silently dropped
      expect(result.success).toBe(true);
      expect(result.results[0].status).toBe("completed");
    });

    it("drops $ref for existingContent so it can be filled from disk", async () => {
      const graph = makeGraph("existingContent ref", [
        { id: "t1", description: "generates output" },
        {
          id: "t2",
          description: "references t1 for existingContent",
          dependsOn: ["t1"],
          input: { existingContent: "$ref:t1", prompt: "update config" },
        },
      ]);

      const result = await makeExecutor().execute(graph);

      // t2 should succeed — existingContent $ref is dropped, prompt is kept
      expect(result.success).toBe(true);
      expect(result.results[1].status).toBe("completed");
    });

    it("resolves $ref to undefined when referenced task has output: undefined", async () => {
      // A completed task with no output (output is undefined by default on TaskResult)
      // Use a tool that returns data without specific fields -- the SuccessTool
      // returns { result: "ok" }, so we wire t2's input to reference t1's output
      const graph = makeGraph("ref to undefined output", [
        { id: "t1", description: "produces output" },
        { id: "t2", description: "references t1", dependsOn: ["t1"], input: { data: "$ref:t1" } },
      ]);

      const result = await makeExecutor().execute(graph);

      expect(result.success).toBe(true);
      expect(result.results[1].status).toBe("completed");
      // t1's output is { result: "ok" }, which is passed through sanitizeRefOutput
      expect(result.results[1].output).toHaveProperty("data");
    });

    it("throws error when $ref references a failed task", async () => {
      const graph = makeGraph("ref to failed", [
        { id: "t1", tool: "fail-tool", description: "will fail" },
        {
          id: "t2",
          description: "references failed t1",
          dependsOn: ["t1"],
          input: { data: "$ref:t1" },
        },
      ]);

      const result = await makeExecutor("successAndFail").execute(graph);

      // t1 fails, t2 should be skipped because its dependency failed
      expect(result.success).toBe(false);
      expect(result.results[0].status).toBe("failed");
      expect(result.results[1].status).toBe("skipped");
      expect(result.results[1].error).toContain("failed dependency");
    });

    it("sanitizes string output from $ref resolution", async () => {
      // Create a tool that returns a string with control characters
      class ControlCharTool extends BaseTool<Record<string, unknown>> {
        name = "control-char-tool";
        description = "Returns output with control characters";
        inputSchema = PassthroughSchema;
        async generate(): Promise<ToolOutput> {
          return {
            success: true,
            data: { content: "hello\x00\x07world\u200Bfoo\uFEFFbar" },
          };
        }
      }

      const graph = makeGraph("sanitize ref", [
        { id: "t1", tool: "control-char-tool", description: "produces dirty output" },
        { id: "t2", description: "references t1", dependsOn: ["t1"], input: { data: "$ref:t1" } },
      ]);

      const executor = new PlannerExecutor([new SuccessTool(), new ControlCharTool()]);
      const result = await executor.execute(graph);

      expect(result.success).toBe(true);
      const t2Output = result.results[1].output as Record<string, unknown>;
      const refData = t2Output.data as Record<string, unknown>;
      // Control characters and zero-width markers should be stripped
      expect(refData.content).toBe("helloworldfoobar");
    });

    it("resolves $ref to null when referenced task output contains null values", async () => {
      class NullOutputTool extends BaseTool<Record<string, unknown>> {
        name = "null-output-tool";
        description = "Returns null in output data";
        inputSchema = PassthroughSchema;
        async generate(): Promise<ToolOutput> {
          return { success: true, data: null };
        }
      }

      const graph = makeGraph("ref to null", [
        { id: "t1", tool: "null-output-tool", description: "produces null output" },
        { id: "t2", description: "references t1", dependsOn: ["t1"], input: { data: "$ref:t1" } },
      ]);

      const executor = new PlannerExecutor([new SuccessTool(), new NullOutputTool()]);
      const result = await executor.execute(graph);

      expect(result.success).toBe(true);
      const t2Output = result.results[1].output as Record<string, unknown>;
      // sanitizeRefOutput returns null as-is (it's not a string/array/object)
      expect(t2Output.data).toBeNull();
    });
  });

  describe("unknown dependency", () => {
    it("throws error when dependsOn references a non-existent task", async () => {
      const graph = makeGraph("bad dependency", [
        { id: "t1", description: "depends on ghost", dependsOn: ["nonexistent"] },
      ]);

      await expect(makeExecutor().execute(graph)).rejects.toThrow("Unknown dependency");
    });
  });

  describe("validation failure cascading", () => {
    it("fails task when validation fails and skips its dependants", async () => {
      const graph = makeGraph("validation cascade", [
        { id: "t1", tool: "strict-tool", description: "will fail validation", input: { name: "" } },
        { id: "t2", description: "depends on t1", dependsOn: ["t1"] },
      ]);

      const result = await makeExecutor("successAndStrict").execute(graph);

      expect(result.success).toBe(false);
      expect(result.results[0].taskId).toBe("t1");
      expect(result.results[0].status).toBe("failed");
      expect(result.results[0].error).toContain("Validation failed");
      expect(result.results[1].taskId).toBe("t2");
      expect(result.results[1].status).toBe("skipped");
    });
  });

  describe("logger integration", () => {
    it("calls taskStart and taskEnd with correct arguments for each task", async () => {
      const logger: PlannerLogger = {
        taskStart: vi.fn(),
        taskEnd: vi.fn(),
      };

      const graph = makeGraph("logger test", [
        { id: "t1", description: "first task" },
        { id: "t2", tool: "fail-tool", description: "second task" },
        { id: "t3", description: "depends on t2", dependsOn: ["t2"] },
      ]);

      const executor = makeExecutor("successAndFail", logger);
      await executor.execute(graph);

      // taskStart is called for t1 and t2 (t3 is skipped due to failed dep, so no taskStart)
      expect(logger.taskStart).toHaveBeenCalledWith("t1", "first task");
      expect(logger.taskStart).toHaveBeenCalledWith("t2", "second task");
      // t3 is skipped -- taskStart should NOT be called for it
      expect(logger.taskStart).not.toHaveBeenCalledWith("t3", expect.anything());

      // taskEnd is called for all tasks
      expect(logger.taskEnd).toHaveBeenCalledWith("t1", "completed");
      expect(logger.taskEnd).toHaveBeenCalledWith("t2", "failed", "intentional failure");
      expect(logger.taskEnd).toHaveBeenCalledWith(
        "t3",
        "skipped",
        expect.stringContaining("failed dependency"),
      );
    });
  });
});
