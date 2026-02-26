import { DevOpsTool } from "@dojops/sdk";
import { TaskGraph, TaskNode, TaskResult, TaskStatus, PlannerResult } from "./types";

export interface PlannerLogger {
  taskStart(taskId: string, description: string): void;
  taskEnd(taskId: string, status: TaskStatus, error?: string): void;
}

const noopLogger: PlannerLogger = {
  taskStart() {},
  taskEnd() {},
};

function resolveInputRefs(
  input: Record<string, unknown>,
  results: Map<string, TaskResult>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.startsWith("$ref:")) {
      const refId = value.slice(5);
      const refResult = results.get(refId);
      resolved[key] = refResult?.output;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function topologicalSort(tasks: TaskNode[]): TaskNode[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Validate all dependsOn references point to existing task IDs
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!taskMap.has(dep)) {
        throw new Error(`Unknown dependency "${dep}" in task "${task.id}"`);
      }
    }
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, task.dependsOn.length);
    for (const dep of task.dependsOn) {
      const existing = adjacency.get(dep) ?? [];
      existing.push(task.id);
      adjacency.set(dep, existing);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: TaskNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(taskMap.get(id)!);
    for (const neighbor of adjacency.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== tasks.length) {
    throw new Error("Circular dependency detected in task graph");
  }

  return sorted;
}

export interface PlannerExecuteOptions {
  completedTaskIds?: Set<string>;
}

export class PlannerExecutor {
  private toolMap: Map<string, DevOpsTool>;

  constructor(
    tools: DevOpsTool[],
    private logger: PlannerLogger = noopLogger,
  ) {
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
  }

  async execute(graph: TaskGraph, options?: PlannerExecuteOptions): Promise<PlannerResult> {
    const sorted = topologicalSort(graph.tasks);
    const results = new Map<string, TaskResult>();
    const failed = new Set<string>();
    const completedTaskIds = options?.completedTaskIds ?? new Set<string>();

    for (const task of sorted) {
      if (completedTaskIds.has(task.id)) {
        const result: TaskResult = { taskId: task.id, status: "completed" };
        results.set(task.id, result);
        this.logger.taskEnd(task.id, "completed");
        continue;
      }

      const shouldSkip = task.dependsOn.some((dep) => failed.has(dep));

      if (shouldSkip) {
        failed.add(task.id);
        const result: TaskResult = {
          taskId: task.id,
          status: "skipped",
          error: "Skipped due to failed dependency",
        };
        results.set(task.id, result);
        this.logger.taskEnd(task.id, "skipped");
        continue;
      }

      const tool = this.toolMap.get(task.tool);
      if (!tool) {
        failed.add(task.id);
        const result: TaskResult = {
          taskId: task.id,
          status: "failed",
          error: `Unknown tool: ${task.tool}`,
        };
        results.set(task.id, result);
        this.logger.taskEnd(task.id, "failed", result.error);
        continue;
      }

      this.logger.taskStart(task.id, task.description);

      const resolvedInput = resolveInputRefs(task.input, results);
      const validation = tool.validate(resolvedInput);

      if (!validation.valid) {
        failed.add(task.id);
        const result: TaskResult = {
          taskId: task.id,
          status: "failed",
          error: `Validation failed: ${validation.error}`,
        };
        results.set(task.id, result);
        this.logger.taskEnd(task.id, "failed", result.error);
        continue;
      }

      try {
        const output = await tool.generate(resolvedInput);
        if (!output.success) {
          failed.add(task.id);
          const result: TaskResult = {
            taskId: task.id,
            status: "failed",
            error: output.error,
          };
          results.set(task.id, result);
          this.logger.taskEnd(task.id, "failed", output.error);
        } else {
          const result: TaskResult = {
            taskId: task.id,
            status: "completed",
            output: output.data,
          };
          results.set(task.id, result);
          this.logger.taskEnd(task.id, "completed");
        }
      } catch (err) {
        failed.add(task.id);
        const error = err instanceof Error ? err.message : String(err);
        const result: TaskResult = {
          taskId: task.id,
          status: "failed",
          error,
        };
        results.set(task.id, result);
        this.logger.taskEnd(task.id, "failed", error);
      }
    }

    const allResults = Array.from(results.values());
    const hasRealFailure = allResults.some((r) => r.status === "failed");
    return {
      goal: graph.goal,
      results: allResults,
      success:
        !hasRealFailure &&
        allResults.every((r) => r.status === "completed" || r.status === "skipped"),
    };
  }
}
