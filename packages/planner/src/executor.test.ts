import { describe, it, expect, vi } from "vitest";
import { BaseTool, ToolOutput, z } from "@dojops/sdk";
import { PlannerExecutor, PlannerLogger } from "./executor";
import { TaskGraph } from "./types";

const SuccessInputSchema = z.object({}).passthrough();

class SuccessTool extends BaseTool<Record<string, unknown>> {
  name = "success-tool";
  description = "Always succeeds";
  inputSchema = SuccessInputSchema;
  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    return { success: true, data: { result: "ok", ...input } };
  }
}

class FailTool extends BaseTool<Record<string, unknown>> {
  name = "fail-tool";
  description = "Always fails";
  inputSchema = SuccessInputSchema;
  async generate(): Promise<ToolOutput> {
    return { success: false, error: "intentional failure" };
  }
}

const timestamps: { id: string; start: number; end: number }[] = [];

class TimingTool extends BaseTool<Record<string, unknown>> {
  name = "timing-tool";
  description = "Records execution timestamps";
  inputSchema = SuccessInputSchema;
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

describe("PlannerExecutor", () => {
  it("executes a chain of tasks in dependency order", async () => {
    const graph: TaskGraph = {
      goal: "test chain",
      tasks: [
        { id: "t1", tool: "success-tool", description: "first", dependsOn: [], input: {} },
        {
          id: "t2",
          tool: "success-tool",
          description: "second",
          dependsOn: ["t1"],
          input: { prev: "$ref:t1" },
        },
      ],
    };

    const executor = new PlannerExecutor([new SuccessTool()]);
    const result = await executor.execute(graph);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("completed");
    expect(result.results[1].status).toBe("completed");
    expect(result.results[1].output).toHaveProperty("prev");
  });

  it("skips downstream tasks when a dependency fails", async () => {
    const graph: TaskGraph = {
      goal: "test failure cascade",
      tasks: [
        { id: "t1", tool: "fail-tool", description: "will fail", dependsOn: [], input: {} },
        {
          id: "t2",
          tool: "success-tool",
          description: "depends on t1",
          dependsOn: ["t1"],
          input: {},
        },
      ],
    };

    const executor = new PlannerExecutor([new SuccessTool(), new FailTool()]);
    const result = await executor.execute(graph);

    expect(result.success).toBe(false);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[1].status).toBe("skipped");
  });

  it("reports error for missing tools", async () => {
    const graph: TaskGraph = {
      goal: "test missing tool",
      tasks: [
        {
          id: "t1",
          tool: "nonexistent",
          description: "unknown tool",
          dependsOn: [],
          input: {},
        },
      ],
    };

    const executor = new PlannerExecutor([new SuccessTool()]);
    const result = await executor.execute(graph);

    expect(result.success).toBe(false);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].error).toContain("Unknown tool");
  });

  it("detects circular dependencies", async () => {
    const graph: TaskGraph = {
      goal: "circular",
      tasks: [
        { id: "t1", tool: "success-tool", description: "a", dependsOn: ["t2"], input: {} },
        { id: "t2", tool: "success-tool", description: "b", dependsOn: ["t1"], input: {} },
      ],
    };

    const executor = new PlannerExecutor([new SuccessTool()]);
    await expect(executor.execute(graph)).rejects.toThrow("Circular dependency");
  });

  it("skips tasks in completedTaskIds", async () => {
    const started: string[] = [];
    const graph: TaskGraph = {
      goal: "test resume skip",
      tasks: [
        { id: "t1", tool: "success-tool", description: "first", dependsOn: [], input: {} },
        { id: "t2", tool: "success-tool", description: "second", dependsOn: ["t1"], input: {} },
        { id: "t3", tool: "success-tool", description: "third", dependsOn: ["t2"], input: {} },
      ],
    };

    const executor = new PlannerExecutor([new SuccessTool()], {
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
    const graph: TaskGraph = {
      goal: "test resume dependency",
      tasks: [
        { id: "t1", tool: "success-tool", description: "first", dependsOn: [], input: {} },
        { id: "t2", tool: "success-tool", description: "second", dependsOn: ["t1"], input: {} },
      ],
    };

    const executor = new PlannerExecutor([new SuccessTool()]);
    const result = await executor.execute(graph, {
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
      const graph: TaskGraph = {
        goal: "test cascading skip",
        tasks: [
          { id: "t1", tool: "fail-tool", description: "will fail", dependsOn: [], input: {} },
          {
            id: "t2",
            tool: "success-tool",
            description: "depends on t1",
            dependsOn: ["t1"],
            input: {},
          },
          {
            id: "t3",
            tool: "success-tool",
            description: "depends on t2",
            dependsOn: ["t2"],
            input: {},
          },
        ],
      };

      const executor = new PlannerExecutor([new SuccessTool(), new FailTool()]);
      const result = await executor.execute(graph);

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
      const graph: TaskGraph = {
        goal: "empty plan",
        tasks: [],
      };

      const executor = new PlannerExecutor([new SuccessTool()]);
      const result = await executor.execute(graph);

      // Empty graph: no failures, every() on empty returns true => success: true
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe("parallel execution", () => {
    it("runs independent tasks concurrently rather than sequentially", async () => {
      // Clear timestamps from prior tests
      timestamps.length = 0;

      const graph: TaskGraph = {
        goal: "parallel test",
        tasks: [
          {
            id: "t1",
            tool: "timing-tool",
            description: "task 1",
            dependsOn: [],
            input: { taskId: "t1" },
          },
          {
            id: "t2",
            tool: "timing-tool",
            description: "task 2",
            dependsOn: [],
            input: { taskId: "t2" },
          },
          {
            id: "t3",
            tool: "timing-tool",
            description: "task 3",
            dependsOn: [],
            input: { taskId: "t3" },
          },
        ],
      };

      const executor = new PlannerExecutor([new TimingTool()]);
      const result = await executor.execute(graph);

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

  describe("$ref to unknown task", () => {
    it("throws error when $ref references a task that does not exist", async () => {
      const graph: TaskGraph = {
        goal: "bad ref",
        tasks: [
          {
            id: "t1",
            tool: "success-tool",
            description: "uses bad ref",
            dependsOn: [],
            input: { data: "$ref:nonexistent" },
          },
        ],
      };

      const executor = new PlannerExecutor([new SuccessTool()]);
      // resolveInputRefs throws before the try/catch that wraps generate(),
      // so the error propagates as a rejection from execute()
      await expect(executor.execute(graph)).rejects.toThrow("references unknown task");
    });
  });

  describe("unknown dependency", () => {
    it("throws error when dependsOn references a non-existent task", async () => {
      const graph: TaskGraph = {
        goal: "bad dependency",
        tasks: [
          {
            id: "t1",
            tool: "success-tool",
            description: "depends on ghost",
            dependsOn: ["nonexistent"],
            input: {},
          },
        ],
      };

      const executor = new PlannerExecutor([new SuccessTool()]);
      await expect(executor.execute(graph)).rejects.toThrow("Unknown dependency");
    });
  });

  describe("validation failure cascading", () => {
    it("fails task when validation fails and skips its dependants", async () => {
      const graph: TaskGraph = {
        goal: "validation cascade",
        tasks: [
          {
            id: "t1",
            tool: "strict-tool",
            description: "will fail validation",
            dependsOn: [],
            input: { name: "" },
          },
          {
            id: "t2",
            tool: "success-tool",
            description: "depends on t1",
            dependsOn: ["t1"],
            input: {},
          },
        ],
      };

      const executor = new PlannerExecutor([new SuccessTool(), new StrictTool()]);
      const result = await executor.execute(graph);

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

      const graph: TaskGraph = {
        goal: "logger test",
        tasks: [
          {
            id: "t1",
            tool: "success-tool",
            description: "first task",
            dependsOn: [],
            input: {},
          },
          {
            id: "t2",
            tool: "fail-tool",
            description: "second task",
            dependsOn: [],
            input: {},
          },
          {
            id: "t3",
            tool: "success-tool",
            description: "depends on t2",
            dependsOn: ["t2"],
            input: {},
          },
        ],
      };

      const executor = new PlannerExecutor([new SuccessTool(), new FailTool()], logger);
      await executor.execute(graph);

      // taskStart is called for t1 and t2 (t3 is skipped due to failed dep, so no taskStart)
      expect(logger.taskStart).toHaveBeenCalledWith("t1", "first task");
      expect(logger.taskStart).toHaveBeenCalledWith("t2", "second task");
      // t3 is skipped — taskStart should NOT be called for it
      expect(logger.taskStart).not.toHaveBeenCalledWith("t3", expect.anything());

      // taskEnd is called for all tasks
      expect(logger.taskEnd).toHaveBeenCalledWith("t1", "completed");
      expect(logger.taskEnd).toHaveBeenCalledWith("t2", "failed", "intentional failure");
      expect(logger.taskEnd).toHaveBeenCalledWith("t3", "skipped");
    });
  });
});
