import { describe, it, expect, vi } from "vitest";
import { BaseSkill, SkillOutput, z } from "@dojops/sdk";
import { PlannerExecutor, PlannerLogger } from "../executor";
import { TaskGraph } from "../types";
import { AgentCoordinator } from "../coordinator";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const PassthroughSchema = z.object({}).passthrough();

// ---------------------------------------------------------------------------
// Mock tools
// ---------------------------------------------------------------------------

class SuccessTool extends BaseSkill<Record<string, unknown>> {
  name = "success-tool";
  description = "Always succeeds";
  inputSchema = PassthroughSchema;
  async generate(input: Record<string, unknown>): Promise<SkillOutput> {
    return { success: true, data: { result: "ok", ...input } };
  }
}

class FailTool extends BaseSkill<Record<string, unknown>> {
  name = "fail-tool";
  description = "Always fails";
  inputSchema = PassthroughSchema;
  async generate(): Promise<SkillOutput> {
    return { success: false, error: "intentional failure" };
  }
}

const timestamps: { id: string; start: number; end: number }[] = [];

class TimingTool extends BaseSkill<Record<string, unknown>> {
  name = "timing-tool";
  description = "Records execution timestamps";
  inputSchema = PassthroughSchema;
  async generate(input: Record<string, unknown>): Promise<SkillOutput> {
    const id = (input.taskId as string) ?? "unknown";
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    const end = Date.now();
    timestamps.push({ id, start, end });
    return { success: true, data: { result: "ok" } };
  }
}

const StrictInputSchema = z.object({ name: z.string().min(1) });

class StrictTool extends BaseSkill<{ name: string }> {
  name = "strict-tool";
  description = "Requires a non-empty name field";
  inputSchema = StrictInputSchema;
  async generate(input: { name: string }): Promise<SkillOutput> {
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
      class ControlCharTool extends BaseSkill<Record<string, unknown>> {
        name = "control-char-tool";
        description = "Returns output with control characters";
        inputSchema = PassthroughSchema;
        async generate(): Promise<SkillOutput> {
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
      class NullOutputTool extends BaseSkill<Record<string, unknown>> {
        name = "null-output-tool";
        description = "Returns null in output data";
        inputSchema = PassthroughSchema;
        async generate(): Promise<SkillOutput> {
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

  describe("agent context injection", () => {
    it("injects _agentContext when task has an assigned agent with matching config", async () => {
      let capturedInput: Record<string, unknown> = {};
      class CaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input for inspection";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          capturedInput = input;
          return { success: true, data: { result: "ok" } };
        }
      }

      const graph = makeGraph("agent context test", [
        {
          id: "t1",
          tool: "capture-tool",
          description: "task with agent",
          input: { prompt: "test" },
        },
      ]);
      // Assign agent to the task
      graph.tasks[0].agent = "terraform-specialist";

      const agentConfigs = new Map([
        [
          "terraform-specialist",
          { systemPrompt: "You are a Terraform infrastructure specialist." },
        ],
      ]);
      const executor = new PlannerExecutor([new CaptureTool()], undefined, { agentConfigs });
      const result = await executor.execute(graph);

      expect(result.success).toBe(true);
      expect(capturedInput._agentContext).toBe("You are a Terraform infrastructure specialist.");
      expect(capturedInput.prompt).toBe("test");
    });

    it("does not inject _agentContext when task has no agent assigned", async () => {
      let capturedInput: Record<string, unknown> = {};
      class CaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input for inspection";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          capturedInput = input;
          return { success: true, data: { result: "ok" } };
        }
      }

      const graph = makeGraph("no agent test", [
        {
          id: "t1",
          tool: "capture-tool",
          description: "task without agent",
          input: { prompt: "test" },
        },
      ]);

      const agentConfigs = new Map([
        [
          "terraform-specialist",
          { systemPrompt: "You are a Terraform infrastructure specialist." },
        ],
      ]);
      const executor = new PlannerExecutor([new CaptureTool()], undefined, { agentConfigs });
      const result = await executor.execute(graph);

      expect(result.success).toBe(true);
      expect(capturedInput._agentContext).toBeUndefined();
    });

    it("does not inject _agentContext when agent name has no matching config", async () => {
      let capturedInput: Record<string, unknown> = {};
      class CaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input for inspection";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          capturedInput = input;
          return { success: true, data: { result: "ok" } };
        }
      }

      const graph = makeGraph("unknown agent test", [
        {
          id: "t1",
          tool: "capture-tool",
          description: "task with unknown agent",
          input: { prompt: "test" },
        },
      ]);
      graph.tasks[0].agent = "nonexistent-specialist";

      const agentConfigs = new Map([
        [
          "terraform-specialist",
          { systemPrompt: "You are a Terraform infrastructure specialist." },
        ],
      ]);
      const executor = new PlannerExecutor([new CaptureTool()], undefined, { agentConfigs });
      const result = await executor.execute(graph);

      expect(result.success).toBe(true);
      expect(capturedInput._agentContext).toBeUndefined();
    });
  });

  describe("dependency context injection", () => {
    it("injects _dependencyContext listing dependency statuses", async () => {
      let capturedInput: Record<string, unknown> = {};
      class CaptureTool2 extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          capturedInput = input;
          return { success: true, data: { result: "ok" } };
        }
      }

      const graph = makeGraph("dep context test", [
        { id: "t1", tool: "capture-tool", description: "first" },
        {
          id: "t2",
          tool: "capture-tool",
          description: "depends on t1",
          dependsOn: ["t1"],
          input: { prompt: "test" },
        },
      ]);

      const executor = new PlannerExecutor([new CaptureTool2()]);
      const result = await executor.execute(graph);

      expect(result.success).toBe(true);
      expect(capturedInput._dependencyContext).toBe("- t1: completed");
    });

    it("does not inject _dependencyContext for tasks without dependencies", async () => {
      let capturedInput: Record<string, unknown> = {};
      class CaptureTool3 extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          capturedInput = input;
          return { success: true, data: { result: "ok" } };
        }
      }

      const graph = makeGraph("no deps", [
        { id: "t1", tool: "capture-tool", description: "standalone" },
      ]);

      const executor = new PlannerExecutor([new CaptureTool3()]);
      await executor.execute(graph);

      expect(capturedInput._dependencyContext).toBeUndefined();
    });
  });

  describe("default repair attempts", () => {
    it("retries once on first failure when using default maxRepairAttempts", async () => {
      let generateCount = 0;
      class RetryTool extends BaseSkill<Record<string, unknown>> {
        name = "retry-tool";
        description = "Fails first, succeeds second";
        inputSchema = PassthroughSchema;
        async generate(): Promise<SkillOutput> {
          generateCount++;
          if (generateCount === 1) {
            return { success: false, error: "transient error" };
          }
          return { success: true, data: { result: "fixed" } };
        }
      }

      const graph = makeGraph("retry test", [
        { id: "t1", tool: "retry-tool", description: "retryable task" },
      ]);

      // Default maxRepairAttempts is now 1
      const executor = new PlannerExecutor([new RetryTool()]);
      const result = await executor.execute(graph);

      expect(generateCount).toBe(2);
      expect(result.success).toBe(true);
      expect(result.results[0].status).toBe("completed");
    });

    it("does not retry when maxRepairAttempts is explicitly 0", async () => {
      let generateCount = 0;
      class FailOnce extends BaseSkill<Record<string, unknown>> {
        name = "fail-once-tool";
        description = "Always fails";
        inputSchema = PassthroughSchema;
        async generate(): Promise<SkillOutput> {
          generateCount++;
          return { success: false, error: "permanent error" };
        }
      }

      const graph = makeGraph("no retry test", [
        { id: "t1", tool: "fail-once-tool", description: "will fail" },
      ]);

      const executor = new PlannerExecutor([new FailOnce()], undefined, {
        maxRepairAttempts: 0,
      });
      const result = await executor.execute(graph);

      expect(generateCount).toBe(1);
      expect(result.success).toBe(false);
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

  describe("task result pruning", () => {
    it("prunes completed task output when no later task references it via $ref", async () => {
      // t1 produces output, t2 does NOT reference t1 via $ref
      const graph = makeGraph("pruning test", [
        { id: "t1", description: "early task" },
        { id: "t2", description: "later task", dependsOn: ["t1"] },
      ]);

      const executor = makeExecutor("success");
      const result = await executor.execute(graph);

      // t1's output should have been pruned (t2 doesn't $ref it)
      const t1Result = result.results.find((r) => r.taskId === "t1");
      expect(t1Result?.status).toBe("completed");
      expect(t1Result?.output).toBeUndefined();
    });

    it("preserves $ref'd task output until dependants execute", async () => {
      // t2 explicitly references t1 output via $ref
      const graph = makeGraph("ref preservation test", [
        { id: "t1", description: "producer" },
        { id: "t2", description: "consumer", dependsOn: ["t1"], input: { prev: "$ref:t1" } },
      ]);

      // Need a capture tool to verify the resolved input was available
      let capturedInput: Record<string, unknown> = {};
      class RefCaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "success-tool";
        description = "Captures input";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          capturedInput = input;
          return { success: true, data: { result: "captured" } };
        }
      }

      const executor = new PlannerExecutor([new RefCaptureTool()]);
      const result = await executor.execute(graph);

      // t2 should have received t1's output as resolved input
      expect(capturedInput.prev).toBeDefined();
      expect(result.success).toBe(true);
    });

    it("preserves failed task error info (only prunes completed outputs)", async () => {
      const graph = makeGraph("error preservation", [
        { id: "t1", tool: "fail-tool", description: "failing task" },
      ]);

      const executor = makeExecutor("successAndFail");
      const result = await executor.execute(graph);

      const t1Result = result.results.find((r) => r.taskId === "t1");
      expect(t1Result?.status).toBe("failed");
      expect(t1Result?.error).toBe("intentional failure");
    });
  });

  describe("per-task success criteria", () => {
    it("fails task when output is below minOutputLength", async () => {
      const graph = makeGraph("min length test", [
        {
          id: "t1",
          description: "short output",
          successCriteria: { minOutputLength: 100 },
        },
      ]);

      // SuccessTool returns { result: "ok" } which serializes to ~15 chars
      // Use maxRepairAttempts: 0 so the short output fails immediately
      const executor = new PlannerExecutor([successTool], undefined, { maxRepairAttempts: 0 });
      const result = await executor.execute(graph);

      expect(result.results[0].status).toBe("failed");
      expect(result.results[0].error).toContain("Output too short");
    });

    it("fails task when required pattern is missing", async () => {
      const graph = makeGraph("required pattern test", [
        {
          id: "t1",
          description: "missing pattern",
          successCriteria: { requiredPatterns: ['resource\\s+"aws_'] },
        },
      ]);

      const executor = new PlannerExecutor([successTool], undefined, { maxRepairAttempts: 0 });
      const result = await executor.execute(graph);

      expect(result.results[0].status).toBe("failed");
      expect(result.results[0].error).toContain("Required pattern not found");
    });

    it("fails task when forbidden pattern is present", async () => {
      // SuccessTool output includes "ok", so use that as a forbidden pattern
      const graph = makeGraph("forbidden pattern test", [
        {
          id: "t1",
          description: "has forbidden",
          successCriteria: { forbiddenPatterns: ["ok"] },
        },
      ]);

      const executor = new PlannerExecutor([successTool], undefined, { maxRepairAttempts: 0 });
      const result = await executor.execute(graph);

      expect(result.results[0].status).toBe("failed");
      expect(result.results[0].error).toContain("Forbidden pattern found");
    });

    it("succeeds when no criteria are set", async () => {
      const graph = makeGraph("no criteria", [{ id: "t1", description: "no criteria" }]);

      const executor = makeExecutor("success");
      const result = await executor.execute(graph);
      expect(result.results[0].status).toBe("completed");
    });

    it("triggers repair loop when criteria fail and retries remain", async () => {
      let callCount = 0;
      class GrowingTool extends BaseSkill<Record<string, unknown>> {
        name = "success-tool";
        description = "Output grows on retry";
        inputSchema = PassthroughSchema;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async generate(_input: Record<string, unknown>): Promise<SkillOutput> {
          callCount++;
          // First call: short output. Second call: long output that passes criteria.
          const content = callCount === 1 ? "short" : "a".repeat(50);
          return { success: true, data: { content } };
        }
      }

      const graph = makeGraph("repair on criteria", [
        {
          id: "t1",
          description: "needs long output",
          successCriteria: { minOutputLength: 40 },
        },
      ]);

      const executor = new PlannerExecutor([new GrowingTool()]);
      const result = await executor.execute(graph);

      expect(callCount).toBe(2); // First attempt failed criteria, second passed
      expect(result.results[0].status).toBe("completed");
    });
  });

  describe("aggregate quality gate", () => {
    it("returns score=1.0 when all tasks succeed", async () => {
      const graph = makeGraph("all success", [{ id: "t1" }, { id: "t2" }, { id: "t3" }]);

      const executor = makeExecutor("success");
      const result = await executor.execute(graph);

      expect(result.quality).toBeDefined();
      expect(result.quality!.score).toBe(1.0);
      expect(result.quality!.skippedTasks).toEqual([]);
      expect(result.quality!.summary).toContain("3/3");
    });

    it("returns partial score when some tasks fail", async () => {
      const graph = makeGraph("partial", [
        { id: "t1" },
        { id: "t2", tool: "fail-tool" },
        { id: "t3" },
      ]);

      const executor = makeExecutor("successAndFail");
      const result = await executor.execute(graph);

      expect(result.quality!.score).toBeCloseTo(2 / 3, 2);
      expect(result.quality!.summary).toContain("2/3");
    });

    it("tracks skipped tasks in quality", async () => {
      const graph = makeGraph("skip tracking", [
        { id: "t1", tool: "fail-tool" },
        { id: "t2", dependsOn: ["t1"] },
      ]);

      const executor = makeExecutor("successAndFail");
      const result = await executor.execute(graph);

      expect(result.quality!.score).toBe(0);
      expect(result.quality!.skippedTasks).toContain("t2");
    });
  });

  // ── Coordinator integration ───────────────────────────────────

  describe("coordinator integration", () => {
    class ShareTool extends BaseSkill<Record<string, unknown>> {
      name = "share-tool";
      description = "Publishes shared context via _share: keys";
      inputSchema = PassthroughSchema;
      async generate(input: Record<string, unknown>): Promise<SkillOutput> {
        return {
          success: true,
          data: {
            result: "ok",
            "_share:region": "us-east-1",
            "_share:vpc": "vpc-123",
            ...input,
          },
        };
      }
    }

    it("task output with _share: keys publishes to coordinator", async () => {
      const coordinator = new AgentCoordinator();
      const executor = new PlannerExecutor([new ShareTool()], undefined, { coordinator });

      const graph: TaskGraph = {
        goal: "test sharing",
        tasks: [{ id: "t1", tool: "share-tool", description: "share", dependsOn: [], input: {} }],
      };

      await executor.execute(graph);

      expect(coordinator.get("region")).toBe("us-east-1");
      expect(coordinator.get("vpc")).toBe("vpc-123");
    });

    it("downstream task receives _sharedContext injection", async () => {
      const coordinator = new AgentCoordinator();
      const receivedInputs: Record<string, unknown>[] = [];

      class CaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input for inspection";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          receivedInputs.push(input);
          return { success: true, data: { result: "captured" } };
        }
      }

      const executor = new PlannerExecutor([new ShareTool(), new CaptureTool()], undefined, {
        coordinator,
      });

      const graph: TaskGraph = {
        goal: "test context flow",
        tasks: [
          {
            id: "t1",
            tool: "share-tool",
            description: "publish context",
            dependsOn: [],
            input: {},
          },
          {
            id: "t2",
            tool: "capture-tool",
            description: "consume context",
            dependsOn: ["t1"],
            input: {},
          },
        ],
      };

      await executor.execute(graph);

      expect(receivedInputs).toHaveLength(1);
      const t2Input = receivedInputs[0];
      expect(t2Input._sharedContext).toBeDefined();
      expect(t2Input._sharedContext as string).toContain("region");
      expect(t2Input._sharedContext as string).toContain("us-east-1");
    });

    it("messages delivered between tasks", async () => {
      const coordinator = new AgentCoordinator();
      // Pre-send a message to t1
      coordinator.send({ from: "external", to: "t1", type: "info", payload: "pre-loaded message" });

      const receivedInputs: Record<string, unknown>[] = [];

      class CaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures input";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          receivedInputs.push(input);
          return { success: true, data: { result: "ok" } };
        }
      }

      const executor = new PlannerExecutor([new CaptureTool()], undefined, { coordinator });

      const graph: TaskGraph = {
        goal: "test messages",
        tasks: [
          { id: "t1", tool: "capture-tool", description: "receive msg", dependsOn: [], input: {} },
        ],
      };

      await executor.execute(graph);

      expect(receivedInputs).toHaveLength(1);
      expect(receivedInputs[0]._coordinatorMessages).toBeDefined();
      expect(receivedInputs[0]._coordinatorMessages as string).toContain("pre-loaded message");
    });

    it("handoff processed by target task", async () => {
      const coordinator = new AgentCoordinator();
      coordinator.requestHandoff({
        from: "external",
        to: "t1",
        reason: "Discovered VPC config",
        partialOutput: { vpcId: "vpc-999" },
      });

      const receivedInputs: Record<string, unknown>[] = [];

      class CaptureTool extends BaseSkill<Record<string, unknown>> {
        name = "capture-tool";
        description = "Captures";
        inputSchema = PassthroughSchema;
        async generate(input: Record<string, unknown>): Promise<SkillOutput> {
          receivedInputs.push(input);
          return { success: true, data: { result: "ok" } };
        }
      }

      const executor = new PlannerExecutor([new CaptureTool()], undefined, { coordinator });

      const graph: TaskGraph = {
        goal: "test handoffs",
        tasks: [
          { id: "t1", tool: "capture-tool", description: "handoff", dependsOn: [], input: {} },
        ],
      };

      await executor.execute(graph);

      expect(receivedInputs).toHaveLength(1);
      expect(receivedInputs[0]._handoffs).toBeDefined();
      expect(receivedInputs[0]._handoffs as string).toContain("VPC config");
      expect(receivedInputs[0]._handoffs as string).toContain("vpc-999");
    });

    it("coordinatorSnapshot included in PlannerResult", async () => {
      const coordinator = new AgentCoordinator();
      const executor = new PlannerExecutor([new ShareTool()], undefined, { coordinator });

      const graph: TaskGraph = {
        goal: "test snapshot",
        tasks: [{ id: "t1", tool: "share-tool", description: "share", dependsOn: [], input: {} }],
      };

      const result = await executor.execute(graph);

      expect(result.coordinatorSnapshot).toBeDefined();
      expect(result.coordinatorSnapshot!.contextKeys).toContain("region");
      expect(result.coordinatorSnapshot!.contextKeys).toContain("vpc");
      expect(result.coordinatorSnapshot!.pendingMessages).toBe(0);
      expect(result.coordinatorSnapshot!.pendingHandoffs).toBe(0);
    });
  });
});
