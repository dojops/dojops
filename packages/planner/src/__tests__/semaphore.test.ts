import { describe, it, expect } from "vitest";
import { BaseSkill, SkillOutput, z } from "@dojops/sdk";
import { PlannerExecutor } from "../executor";
import { TaskGraph } from "../types";

const PassthroughSchema = z.object({}).passthrough();

// Tool that records start/end timestamps with configurable delay
const execLog: { id: string; start: number; end: number }[] = [];

class DelayTool extends BaseSkill<Record<string, unknown>> {
  name = "delay-tool";
  description = "Delays for a configurable amount of time";
  inputSchema = PassthroughSchema;
  async generate(input: Record<string, unknown>): Promise<SkillOutput> {
    const id = (input.taskId as string) ?? "unknown";
    const delayMs = (input.delayMs as number) ?? 50;
    const start = Date.now();
    await new Promise((r) => setTimeout(r, delayMs));
    const end = Date.now();
    execLog.push({ id, start, end });
    return { success: true, data: { result: "ok" } };
  }
}

function makeGraph(
  tasks: Array<{ id: string; input?: Record<string, unknown>; dependsOn?: string[] }>,
): TaskGraph {
  return {
    goal: "semaphore test",
    tasks: tasks.map((t) => ({
      id: t.id,
      tool: "delay-tool",
      description: t.id,
      dependsOn: t.dependsOn ?? [],
      input: t.input ?? { taskId: t.id, delayMs: 50 },
    })),
  };
}

describe("executeWithSemaphore", () => {
  it("starts new tasks as soon as slots free up (not fixed chunks)", async () => {
    execLog.length = 0;

    // 4 independent tasks with maxConcurrency: 2
    // t1: 10ms (fast), t2: 100ms, t3: 100ms, t4: 100ms
    // With chunks: [t1, t2] wait 100ms -> [t3, t4] wait 100ms = ~200ms
    // With semaphore: t1+t2 start -> t1 finishes 10ms -> t3 starts -> t2 finishes 100ms -> t4 starts -> total ~110ms+100ms = ~210ms for chunks vs ~200ms for semaphore
    //
    // Better test: verify that t3 starts BEFORE t2 finishes (proving eager scheduling)
    const graph = makeGraph([
      { id: "t1", input: { taskId: "t1", delayMs: 10 } },
      { id: "t2", input: { taskId: "t2", delayMs: 150 } },
      { id: "t3", input: { taskId: "t3", delayMs: 10 } },
      { id: "t4", input: { taskId: "t4", delayMs: 10 } },
    ]);

    const executor = new PlannerExecutor([new DelayTool()]);
    const result = await executor.execute(graph, { maxConcurrency: 2 });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(4);

    // With semaphore: t3 should start shortly after t1 finishes (~10ms), NOT after t2 finishes (~150ms)
    // With chunks: t3 would start only after both t1 AND t2 complete (~150ms)
    const t1 = execLog.find((e) => e.id === "t1")!;
    const t2 = execLog.find((e) => e.id === "t2")!;
    const t3 = execLog.find((e) => e.id === "t3")!;

    // t3 should start before t2 ends (proving the slot was reused immediately)
    expect(t3.start).toBeLessThan(t2.end);
    // t3 should start after t1 ends (it took t1's slot)
    expect(t3.start).toBeGreaterThanOrEqual(t1.end - 5); // 5ms tolerance
  });

  it("respects maxConcurrency limit", async () => {
    // Use a concurrent counter instead of timestamp overlap (more reliable in CI)
    let concurrentCount = 0;
    let maxObserved = 0;

    class CounterTool extends BaseSkill<Record<string, unknown>> {
      name = "counter-tool";
      description = "Tracks max concurrent execution";
      inputSchema = PassthroughSchema;
      async generate(): Promise<SkillOutput> {
        concurrentCount++;
        if (concurrentCount > maxObserved) maxObserved = concurrentCount;
        await new Promise((r) => setTimeout(r, 50));
        concurrentCount--;
        return { success: true, data: { result: "ok" } };
      }
    }

    const graph: TaskGraph = {
      goal: "concurrency test",
      tasks: [
        { id: "t1", tool: "counter-tool", description: "t1", dependsOn: [], input: {} },
        { id: "t2", tool: "counter-tool", description: "t2", dependsOn: [], input: {} },
        { id: "t3", tool: "counter-tool", description: "t3", dependsOn: [], input: {} },
        { id: "t4", tool: "counter-tool", description: "t4", dependsOn: [], input: {} },
      ],
    };

    const executor = new PlannerExecutor([new CounterTool()]);
    const result = await executor.execute(graph, { maxConcurrency: 2 });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(4);
    expect(maxObserved).toBeLessThanOrEqual(2);
    expect(maxObserved).toBe(2); // Should actually use both slots
  });

  it("handles empty task list", async () => {
    const graph: TaskGraph = { goal: "empty", tasks: [] };
    const executor = new PlannerExecutor([new DelayTool()]);
    const result = await executor.execute(graph);

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it("handles single task", async () => {
    execLog.length = 0;
    const graph = makeGraph([{ id: "t1", input: { taskId: "t1", delayMs: 10 } }]);

    const executor = new PlannerExecutor([new DelayTool()]);
    const result = await executor.execute(graph, { maxConcurrency: 5 });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("completed");
  });

  it("works with maxConcurrency: 1 (sequential)", async () => {
    execLog.length = 0;

    const graph = makeGraph([
      { id: "t1", input: { taskId: "t1", delayMs: 20 } },
      { id: "t2", input: { taskId: "t2", delayMs: 20 } },
      { id: "t3", input: { taskId: "t3", delayMs: 20 } },
    ]);

    const executor = new PlannerExecutor([new DelayTool()]);
    const result = await executor.execute(graph, { maxConcurrency: 1 });

    expect(result.success).toBe(true);

    // With maxConcurrency: 1, tasks should NOT overlap
    for (let i = 1; i < execLog.length; i++) {
      expect(execLog[i].start).toBeGreaterThanOrEqual(execLog[i - 1].end);
    }
  });
});
