import { z } from "zod";

export const WorkflowStepSchema = z.object({
  name: z.string(),
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string()).optional(),
});

export const WorkflowJobSchema = z.object({
  "runs-on": z.string().optional(),
  uses: z.string().optional(),
  with: z.record(z.unknown()).optional(),
  steps: z.array(WorkflowStepSchema).optional(),
});

export const WorkflowSchema = z.object({
  name: z.string(),
  on: z.union([z.record(z.unknown()), z.array(z.string()), z.string()]),
  jobs: z.record(WorkflowJobSchema),
});

export const GitHubActionsInputSchema = z.object({
  projectPath: z
    .string()
    .describe(
      "Root directory of the project (e.g. '.' or './my-app'), not the .github/workflows directory",
    ),
  nodeVersion: z.string().default("20"),
  defaultBranch: z.string().default("main"),
  existingContent: z
    .string()
    .optional()
    .describe(
      "Existing config file content to update/enhance. If omitted, tool auto-detects existing files.",
    ),
});

export type GitHubActionsInput = z.infer<typeof GitHubActionsInputSchema>;

export const LLMWorkflowResponseSchema = WorkflowSchema;

export type Workflow = z.infer<typeof WorkflowSchema>;
