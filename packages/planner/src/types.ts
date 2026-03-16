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

/** Extended TaskNode with optional tool metadata (enriched after decomposition). */
export type TaskNode = TaskNodeBase & {
  toolType?: "built-in" | "custom";
  toolVersion?: string;
  toolHash?: string;
  toolSource?: "global" | "project";
  systemPromptHash?: string;
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

export interface PlannerResult {
  goal: string;
  results: TaskResult[];
  success: boolean;
}
