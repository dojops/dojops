import { z } from "zod";

export const TaskNodeSchema = z.object({
  id: z.string(),
  tool: z.string(),
  agent: z.string().optional(),
  description: z.string(),
  dependsOn: z.array(z.string()).default([]),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const TaskGraphSchema = z.object({
  goal: z.string(),
  tasks: z.array(TaskNodeSchema).min(1),
});

/**
 * Build a TaskGraph schema with tool name constrained to valid skill names.
 * This prevents LLMs from hallucinating non-existent skill names (e.g. "helm-chart" instead of "helm").
 * Falls back to the unconstrained schema if no tool names are provided.
 */
export function createTaskGraphSchema(
  validToolNames: string[],
): z.ZodType<z.infer<typeof TaskGraphSchema>> {
  if (validToolNames.length === 0) return TaskGraphSchema;

  const toolEnum = z.enum(validToolNames as [string, ...string[]]);
  const constrainedNode = z.object({
    id: z.string(),
    tool: toolEnum,
    agent: z.string().optional(),
    description: z.string(),
    dependsOn: z.array(z.string()).default([]),
    input: z.record(z.string(), z.unknown()).default({}),
  });

  return z.object({
    goal: z.string(),
    tasks: z.array(constrainedNode).min(1),
  }) as unknown as z.ZodType<z.infer<typeof TaskGraphSchema>>;
}

/** Base type inferred from the Zod schema (LLM output). */
type TaskNodeBase = z.infer<typeof TaskNodeSchema>;

/** Programmatic success criteria for a task (set by caller, not by LLM). */
export interface TaskSuccessCriteria {
  /** Minimum output length in characters. */
  minOutputLength?: number;
  /** Regex patterns that must appear in the output. */
  requiredPatterns?: string[];
  /** Regex patterns that must NOT appear (e.g., "TODO", "FIXME"). */
  forbiddenPatterns?: string[];
}

/** Extended TaskNode with optional tool metadata (enriched after decomposition). */
export type TaskNode = TaskNodeBase & {
  toolType?: "built-in" | "custom";
  toolVersion?: string;
  toolHash?: string;
  toolSource?: "global" | "project";
  systemPromptHash?: string;
  /** Optional success criteria for programmatic validation of output. */
  successCriteria?: TaskSuccessCriteria;
};

export type TaskGraph = Omit<z.infer<typeof TaskGraphSchema>, "tasks"> & {
  tasks: TaskNode[];
};

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output?: unknown;
  error?: string;
}

/** Aggregate quality metrics for a completed plan execution. */
export interface PlanQuality {
  /** 0.0 to 1.0 — ratio of completed tasks. */
  score: number;
  /** Task IDs that were skipped. */
  skippedTasks: string[];
  /** Human-readable summary string. */
  summary: string;
}

/** Snapshot of coordinator state at plan completion. */
export interface CoordinatorSnapshot {
  contextKeys: string[];
  pendingMessages: number;
  pendingHandoffs: number;
}

export interface PlannerResult {
  goal: string;
  results: TaskResult[];
  success: boolean;
  /** When tasks fail, provides context for cross-task replanning.
   *  The caller can feed this back into the decomposer for a revised plan. */
  replanContext?: string;
  /** Aggregate quality metrics for the plan execution. */
  quality?: PlanQuality;
  /** Coordinator state snapshot (only present when coordinator was used). */
  coordinatorSnapshot?: CoordinatorSnapshot;
}
