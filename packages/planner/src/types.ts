import { z } from "zod";

export const TaskNodeSchema = z.object({
  id: z.string(),
  tool: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()).default([]),
  input: z.record(z.unknown()).default({}),
});

export const TaskGraphSchema = z.object({
  goal: z.string(),
  tasks: z.array(TaskNodeSchema).min(1),
});

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
