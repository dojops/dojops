import { DevOpsSkill } from "@dojops/sdk";
import { TaskGraph, TaskNode, TaskResult, TaskStatus, PlannerResult } from "./types";

export interface PlannerLogger {
  taskStart(taskId: string, description: string): void;
  taskEnd(taskId: string, status: TaskStatus, error?: string): void;
}

const noopLogger: PlannerLogger = {
  taskStart() {},
  taskEnd() {},
};

/** Max size for string values resolved from $ref outputs (50KB) */
const MAX_REF_STRING_LENGTH = 50_000;

/** Strip control characters and Unicode bidi/zero-width markers from strings */
function sanitizeRefString(value: string): string {
  const cleaned = value.replaceAll(
    // eslint-disable-next-line no-control-regex
    /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
    "",
  );
  return cleaned.length > MAX_REF_STRING_LENGTH ? cleaned.slice(0, MAX_REF_STRING_LENGTH) : cleaned;
}

/** Recursively sanitize string values in $ref-resolved data */
function sanitizeRefOutput(value: unknown): unknown {
  if (typeof value === "string") return sanitizeRefString(value);
  if (Array.isArray(value)) return value.map(sanitizeRefOutput);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeRefOutput(v);
    }
    return out;
  }
  return value;
}

// Keys that should always be read from disk, not from $ref task output.
// The apply command injects these from the actual files on disk.
const DISK_SOURCED_KEYS = new Set(["existingContent"]);

function resolveInputRefs(
  input: Record<string, unknown>,
  results: Map<string, TaskResult>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.startsWith("$ref:")) {
      // Drop $ref for fields that should come from disk (e.g. existingContent)
      if (DISK_SOURCED_KEYS.has(key)) continue;

      const refId = value.slice(5);
      const refResult = results.get(refId);
      if (refResult === undefined) {
        // LLM hallucinated a $ref to a non-existent task — drop the key
        // so the tool can fall back to defaults or prompt-based generation
        continue;
      }
      if (refResult.status === "failed" || refResult.status === "skipped") {
        throw new Error(`$ref:${refId} references a ${refResult.status} task`);
      }
      resolved[key] = sanitizeRefOutput(refResult.output);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

function validateDependencies(tasks: TaskNode[], taskMap: Map<string, TaskNode>): void {
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!taskMap.has(dep)) {
        throw new Error(`Unknown dependency "${dep}" in task "${task.id}"`);
      }
    }
  }
}

function buildGraphMaps(tasks: TaskNode[]): {
  inDegree: Map<string, number>;
  adjacency: Map<string, string[]>;
} {
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
  return { inDegree, adjacency };
}

function topologicalSort(tasks: TaskNode[]): TaskNode[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  validateDependencies(tasks, taskMap);

  const { inDegree, adjacency } = buildGraphMaps(tasks);

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: TaskNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const task = taskMap.get(id);
    if (task) sorted.push(task);
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
  /** Maximum number of tasks to execute in parallel within a wave (default: 3) */
  maxConcurrency?: number;
}

async function executeInChunks<T>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const chunk = items.slice(i, i + maxConcurrency);
    await Promise.all(chunk.map(fn));
  }
}

export interface PlannerExecutorOptions {
  /** Timeout in ms for each tool.generate() call (default: unlimited) */
  generateTimeoutMs?: number;
  /** Specialist agent configs: agent name → system prompt for domain context injection */
  agentConfigs?: Map<string, { systemPrompt: string }>;
}

/**
 * Resolve a possibly-hallucinated skill name to a valid one.
 * Tries exact match first, then normalization strategies.
 * Returns undefined if no match is found.
 */
function resolveToolName(
  name: string,
  available: Map<string, DevOpsSkill>,
): DevOpsSkill | undefined {
  // 1. Exact match
  const exact = available.get(name);
  if (exact) return exact;

  // 2. Strip common suffixes LLMs hallucinate (e.g. "helm-chart" → "helm")
  const STRIP_SUFFIXES = [
    "-chart",
    "-config",
    "-file",
    "-template",
    "-manifest",
    "-setup",
    "-yaml",
    "-yml",
  ];
  for (const suffix of STRIP_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const stripped = name.slice(0, -suffix.length);
      const match = available.get(stripped);
      if (match) return match;
    }
  }

  // 3. Check if any available name starts with or is a prefix of the input
  const lower = name.toLowerCase();
  for (const [key, skill] of available) {
    if (lower.startsWith(key) || key.startsWith(lower)) return skill;
  }

  return undefined;
}

export class PlannerExecutor {
  private readonly toolMap: Map<string, DevOpsSkill>;
  private readonly generateTimeoutMs: number | undefined;
  private readonly agentConfigs: Map<string, { systemPrompt: string }> | undefined;

  constructor(
    tools: DevOpsSkill[],
    private readonly logger: PlannerLogger = noopLogger,
    options?: PlannerExecutorOptions,
  ) {
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.generateTimeoutMs = options?.generateTimeoutMs;
    this.agentConfigs = options?.agentConfigs;
  }

  private recordResult(
    task: TaskNode,
    status: TaskStatus,
    results: Map<string, TaskResult>,
    failed: Set<string>,
    error?: string,
    output?: unknown,
  ): void {
    if (status === "failed" || status === "skipped") failed.add(task.id);
    const result: TaskResult = { taskId: task.id, status, error, output };
    results.set(task.id, result);
    if (error) {
      this.logger.taskEnd(task.id, status, error);
    } else {
      this.logger.taskEnd(task.id, status);
    }
  }

  private async executeTask(
    task: TaskNode,
    completedTaskIds: Set<string>,
    failed: Set<string>,
    results: Map<string, TaskResult>,
  ): Promise<void> {
    if (completedTaskIds.has(task.id)) {
      this.recordResult(task, "completed", results, failed);
      return;
    }

    if (task.dependsOn.some((dep) => failed.has(dep))) {
      this.recordResult(task, "skipped", results, failed, "Skipped due to failed dependency");
      return;
    }

    const tool = resolveToolName(task.tool, this.toolMap);
    if (!tool) {
      const available = [...this.toolMap.keys()].join(", ");
      this.recordResult(
        task,
        "failed",
        results,
        failed,
        `Unknown tool: ${task.tool}. Available: ${available}`,
      );
      return;
    }

    this.logger.taskStart(task.id, task.description);
    await this.runToolForTask(task, tool, results, failed);
  }

  private async runToolForTask(
    task: TaskNode,
    tool: DevOpsSkill,
    results: Map<string, TaskResult>,
    failed: Set<string>,
  ): Promise<void> {
    try {
      let resolvedInput = resolveInputRefs(task.input, results);

      // Inject specialist agent domain context when task has an assigned agent
      if (task.agent && this.agentConfigs?.has(task.agent)) {
        const agentConfig = this.agentConfigs.get(task.agent)!;
        resolvedInput = { ...resolvedInput, _agentContext: agentConfig.systemPrompt };
      }

      const validation = tool.validate(resolvedInput);

      if (!validation.valid) {
        this.recordResult(
          task,
          "failed",
          results,
          failed,
          `Validation failed: ${validation.error}`,
        );
        return;
      }

      const generatePromise = tool.generate(resolvedInput);
      const output = this.generateTimeoutMs
        ? await Promise.race([
            generatePromise,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Generate timed out after ${this.generateTimeoutMs}ms`)),
                this.generateTimeoutMs,
              ),
            ),
          ])
        : await generatePromise;
      if (output.success) {
        this.recordResult(task, "completed", results, failed, undefined, output.data);
      } else {
        this.recordResult(task, "failed", results, failed, output.error);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.recordResult(task, "failed", results, failed, error);
    }
  }

  private advanceReadyTasks(
    wave: string[],
    dependants: Map<string, string[]>,
    inDegree: Map<string, number>,
    processed: Set<string>,
    ready: Set<string>,
  ): void {
    for (const completedId of wave) {
      for (const dep of dependants.get(completedId) ?? []) {
        if (processed.has(dep)) continue;
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) ready.add(dep);
      }
    }
  }

  async execute(graph: TaskGraph, options?: PlannerExecuteOptions): Promise<PlannerResult> {
    topologicalSort(graph.tasks);

    const taskMap = new Map(graph.tasks.map((t) => [t.id, t]));
    const results = new Map<string, TaskResult>();
    const failed = new Set<string>();
    const completedTaskIds = options?.completedTaskIds ?? new Set<string>();
    const maxConcurrency = options?.maxConcurrency ?? 3;

    const { inDegree, adjacency: dependants } = buildGraphMaps(graph.tasks);

    const ready = new Set<string>();
    for (const [id, degree] of inDegree) {
      if (degree === 0) ready.add(id);
    }

    const processed = new Set<string>();

    while (ready.size > 0) {
      const wave = [...ready];
      ready.clear();

      await executeInChunks(wave, maxConcurrency, async (taskId) => {
        const task = taskMap.get(taskId)!;
        processed.add(taskId);
        await this.executeTask(task, completedTaskIds, failed, results);
      });

      if (wave.some((id) => failed.has(id)) && wave.some((id) => !failed.has(id))) {
        console.warn(
          `[planner] Wave completed with mixed results — some tasks failed while others succeeded. Manual review recommended.`,
        );
      }

      this.advanceReadyTasks(wave, dependants, inDegree, processed, ready);
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
