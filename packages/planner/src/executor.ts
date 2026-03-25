import { DevOpsSkill, resolveToolName } from "@dojops/sdk";
import {
  TaskGraph,
  TaskNode,
  TaskResult,
  TaskStatus,
  TaskSuccessCriteria,
  PlannerResult,
  PlanQuality,
} from "./types";
import { AgentCoordinator } from "./coordinator";
import { ResultAggregator, type AggregationRule } from "./aggregator";

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

/** Construct a RegExp from an LLM-generated pattern, rejecting ReDoS-prone patterns. */
function safeRegExp(pattern: string): RegExp | null {
  // Reject patterns with adjacent quantifiers (e.g. (a+)+, a**, a*+)
  for (let i = 1; i < pattern.length; i++) {
    const prev = pattern[i - 1];
    const cur = pattern[i];
    if (
      (prev === "+" || prev === "*" || prev === "}") &&
      (cur === "+" || cur === "*" || cur === "{")
    ) {
      return null;
    }
  }
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** Evaluate programmatic success criteria against task output. Returns a list of violations. */
function evaluateSuccessCriteria(criteria: TaskSuccessCriteria, data: unknown): string[] {
  const violations: string[] = [];
  const text = typeof data === "string" ? data : JSON.stringify(data ?? "");

  if (criteria.minOutputLength !== undefined && text.length < criteria.minOutputLength) {
    violations.push(`Output too short (${text.length} < ${criteria.minOutputLength})`);
  }

  for (const pattern of criteria.requiredPatterns ?? []) {
    const re = safeRegExp(pattern);
    if (!re) {
      violations.push(`Invalid or unsafe required pattern: ${pattern}`);
    } else if (!re.test(text)) {
      violations.push(`Required pattern not found: ${pattern}`);
    }
  }

  for (const pattern of criteria.forbiddenPatterns ?? []) {
    const re = safeRegExp(pattern);
    if (!re) {
      violations.push(`Invalid or unsafe forbidden pattern: ${pattern}`);
    } else if (re.test(text)) {
      violations.push(`Forbidden pattern found: ${pattern}`);
    }
  }

  return violations;
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

/**
 * Semaphore-based concurrency pool: starts a new task the instant any slot
 * frees up, instead of waiting for an entire fixed-size chunk to complete.
 * Collects all errors instead of fail-fast so other tasks in the wave complete.
 */
async function executeWithSemaphore<T>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  let running = 0;
  let index = 0;
  const errors: unknown[] = [];

  return new Promise<void>((resolve) => {
    function done(): void {
      if (errors.length > 0) {
        // Log but don't reject — task failures are tracked via recordResult
        console.error(`[planner] ${errors.length} task(s) threw unexpectedly in wave`);
      }
      resolve();
    }
    function startNext(): void {
      while (running < maxConcurrency && index < items.length) {
        const item = items[index++];
        running++;
        fn(item).then(
          () => {
            running--;
            if (index >= items.length && running === 0) done();
            else startNext();
          },
          (err) => {
            errors.push(err);
            running--;
            if (index >= items.length && running === 0) done();
            else startNext();
          },
        );
      }
    }
    startNext();
  });
}

/** Result from verifying a task's output. */
export interface PlannerVerifyResult {
  /** Whether the output passed verification. */
  passed: boolean;
  /** Human-readable error messages when verification fails. */
  errors: string[];
}

/** Optional verification callback injected from the execution layer. */
export type PlannerVerifyFn = (
  tool: DevOpsSkill,
  output: unknown,
  taskId: string,
) => Promise<PlannerVerifyResult>;

export interface PlannerExecutorOptions {
  /** Timeout in ms for each tool.generate() call (default: unlimited) */
  generateTimeoutMs?: number;
  /** Specialist agent configs: agent name → system prompt for domain context injection */
  agentConfigs?: Map<string, { systemPrompt: string }>;
  /** Maximum repair attempts per failed task (default: 0 = no retry). */
  maxRepairAttempts?: number;
  /** When set, enables inter-task coordination (shared context, messages, handoffs). */
  coordinator?: AgentCoordinator;
  /** Result aggregation rules for combining wave outputs. */
  aggregationRules?: AggregationRule[];
  /** Optional post-generate verification. When provided, the repair loop uses
   *  verification errors instead of raw generate errors for targeted feedback. */
  verifyFn?: PlannerVerifyFn;
}

export class PlannerExecutor {
  private readonly toolMap: Map<string, DevOpsSkill>;
  private readonly generateTimeoutMs: number | undefined;
  private readonly agentConfigs: Map<string, { systemPrompt: string }> | undefined;
  private readonly maxRepairAttempts: number;
  private readonly coordinator: AgentCoordinator | undefined;
  private readonly aggregator: ResultAggregator | undefined;
  private readonly verifyFn: PlannerVerifyFn | undefined;

  constructor(
    tools: DevOpsSkill[],
    private readonly logger: PlannerLogger = noopLogger,
    options?: PlannerExecutorOptions,
  ) {
    this.toolMap = new Map(tools.map((t) => [t.name, t]));
    this.generateTimeoutMs = options?.generateTimeoutMs;
    this.agentConfigs = options?.agentConfigs;
    this.maxRepairAttempts = options?.maxRepairAttempts ?? 1;
    this.coordinator = options?.coordinator;
    this.aggregator = options?.aggregationRules
      ? new ResultAggregator(options.aggregationRules)
      : undefined;
    this.verifyFn = options?.verifyFn;
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
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= this.maxRepairAttempts; attempt++) {
      try {
        let resolvedInput = resolveInputRefs(task.input, results);

        // Inject specialist agent domain context when task has an assigned agent
        if (task.agent && this.agentConfigs?.has(task.agent)) {
          const agentConfig = this.agentConfigs.get(task.agent)!;
          resolvedInput = { ...resolvedInput, _agentContext: agentConfig.systemPrompt };
        }

        // Inject lightweight dependency context so each task knows what happened upstream
        if (task.dependsOn.length > 0) {
          const depContext = task.dependsOn
            .map((depId) => {
              const r = results.get(depId);
              return r ? `- ${depId}: ${r.status}` : null;
            })
            .filter(Boolean)
            .join("\n");
          if (depContext) {
            resolvedInput = { ...resolvedInput, _dependencyContext: depContext };
          }
        }

        // Inject coordinator context if available
        if (this.coordinator) {
          this.coordinator.register(task.id);
          const messages = this.coordinator.drain(task.id);
          if (messages.length > 0) {
            resolvedInput = {
              ...resolvedInput,
              _coordinatorMessages: messages
                .map((m) => `[${m.type}] from ${m.from}: ${JSON.stringify(m.payload)}`)
                .join("\n"),
            };
          }
          const sharedCtx = this.coordinator.getAll();
          if (sharedCtx.size > 0) {
            const ctxLines: string[] = [];
            for (const [key, entry] of sharedCtx) {
              ctxLines.push(`${key}: ${JSON.stringify(entry.value)} (from ${entry.source})`);
            }
            resolvedInput = { ...resolvedInput, _sharedContext: ctxLines.join("\n") };
          }
          const handoffs = this.coordinator.drainHandoffs(task.id);
          if (handoffs.length > 0) {
            resolvedInput = {
              ...resolvedInput,
              _handoffs: handoffs
                .map(
                  (h) =>
                    `Handoff from ${h.from}: ${h.reason}\nPartial output: ${JSON.stringify(h.partialOutput)}`,
                )
                .join("\n---\n"),
            };
          }
        }

        // On repair attempts, inject the previous error so the LLM can self-correct
        if (attempt > 0 && lastError) {
          resolvedInput = {
            ...resolvedInput,
            _repairContext: `Attempt ${attempt}/${this.maxRepairAttempts} — previous attempt failed: ${lastError}. Analyze the error and produce a corrected output.`,
          };
        }

        const validation = tool.validate(resolvedInput);

        if (!validation.valid) {
          // Validation failures are structural, not retryable
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
        let output: Awaited<ReturnType<typeof tool.generate>>;
        if (this.generateTimeoutMs) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Generate timed out after ${this.generateTimeoutMs}ms`)),
              this.generateTimeoutMs,
            );
          });
          try {
            output = await Promise.race([generatePromise, timeoutPromise]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        } else {
          output = await generatePromise;
        }

        if (output.success) {
          // Embed usage in data so SafeExecutor can accumulate token counts
          const data =
            output.usage && output.data && typeof output.data === "object"
              ? { ...(output.data as Record<string, unknown>), _usage: output.usage }
              : output.data;

          // Evaluate programmatic success criteria if present
          if (task.successCriteria) {
            const violations = evaluateSuccessCriteria(task.successCriteria, data);
            if (violations.length > 0) {
              lastError = `Success criteria failed: ${violations.join("; ")}`;
              if (attempt < this.maxRepairAttempts) continue;
              this.recordResult(task, "failed", results, failed, lastError);
              return;
            }
          }

          // Run verification when available — drives repair with richer feedback
          if (this.verifyFn) {
            const verifyResult = await this.verifyFn(tool, data, task.id);
            if (!verifyResult.passed) {
              lastError = `Verification failed: ${verifyResult.errors.join("; ")}`;
              if (attempt < this.maxRepairAttempts) continue;
              this.recordResult(task, "failed", results, failed, lastError);
              return;
            }
          }

          // Publish _share: keys to coordinator for downstream tasks
          if (this.coordinator && data && typeof data === "object") {
            for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
              if (key.startsWith("_share:")) {
                this.coordinator.set(key.slice(7), value, task.id);
              }
            }
          }

          this.recordResult(task, "completed", results, failed, undefined, data);
          return;
        }

        lastError = output.error;
        if (attempt < this.maxRepairAttempts) continue;
        this.recordResult(task, "failed", results, failed, output.error);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRepairAttempts) continue;
        this.recordResult(task, "failed", results, failed, lastError);
      }
    }
  }

  /**
   * Free memory from completed task outputs that no unprocessed task references via $ref.
   * Preserves metadata (taskId, status, error) — only nulls potentially large output data.
   */
  private pruneCompletedOutputs(
    results: Map<string, TaskResult>,
    allTasks: TaskNode[],
    processed: Set<string>,
  ): void {
    // Collect all $ref:taskId values from unprocessed tasks' inputs
    const referencedIds = new Set<string>();
    for (const task of allTasks) {
      if (processed.has(task.id)) continue;
      for (const value of Object.values(task.input)) {
        if (typeof value === "string" && value.startsWith("$ref:")) {
          referencedIds.add(value.slice(5));
        }
      }
    }

    // Null output for completed tasks not referenced by remaining work
    for (const [id, result] of results) {
      if (result.status === "completed" && result.output !== undefined && !referencedIds.has(id)) {
        result.output = undefined;
      }
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

      await executeWithSemaphore(wave, maxConcurrency, async (taskId) => {
        const task = taskMap.get(taskId)!;
        processed.add(taskId);
        await this.executeTask(task, completedTaskIds, failed, results);
      });

      if (wave.some((id) => failed.has(id)) && wave.some((id) => !failed.has(id))) {
        console.warn(
          `[planner] Wave completed with mixed results — some tasks failed while others succeeded. Manual review recommended.`,
        );
      }

      // Run aggregation on wave results if configured
      if (this.aggregator && this.coordinator) {
        const waveResults = wave
          .filter((id) => results.has(id) && results.get(id)!.status === "completed")
          .map((id) => ({ taskId: id, output: results.get(id)!.output }));
        if (waveResults.length > 0) {
          const aggregated = this.aggregator.aggregate(waveResults);
          for (const [groupKey, value] of aggregated) {
            this.coordinator.set(`_aggregated:${groupKey}`, value, "wave");
          }
        }
      }

      this.advanceReadyTasks(wave, dependants, inDegree, processed, ready);
      // Only prune when there are still tasks left to execute
      if (ready.size > 0) {
        this.pruneCompletedOutputs(results, graph.tasks, processed);
      }
    }

    const allResults = Array.from(results.values());
    const hasRealFailure = allResults.some((r) => r.status === "failed");
    const success =
      !hasRealFailure &&
      allResults.every((r) => r.status === "completed" || r.status === "skipped");

    // Build replan context from failures so the caller can reinvoke the decomposer
    let replanContext: string | undefined;
    if (hasRealFailure) {
      const failedTasks = allResults.filter((r) => r.status === "failed");
      const completedIds = allResults.filter((r) => r.status === "completed").map((r) => r.taskId);
      const lines = failedTasks.map(
        (r) => `- Task "${r.taskId}" failed: ${r.error ?? "unknown error"}`,
      );
      if (completedIds.length > 0) {
        lines.push(`Already completed: ${completedIds.join(", ")}`);
      }
      replanContext = lines.join("\n");
    }

    // Compute aggregate quality metrics
    const completedCount = allResults.filter((r) => r.status === "completed").length;
    const total = allResults.length;
    const quality: PlanQuality = {
      score: total > 0 ? completedCount / total : 1.0,
      skippedTasks: allResults.filter((r) => r.status === "skipped").map((r) => r.taskId),
      summary: `${completedCount}/${total} tasks completed (${total > 0 ? ((completedCount / total) * 100).toFixed(0) : 100}%)`,
    };

    return {
      goal: graph.goal,
      results: allResults,
      success,
      replanContext,
      quality,
      coordinatorSnapshot: this.coordinator?.snapshot(),
    };
  }
}
