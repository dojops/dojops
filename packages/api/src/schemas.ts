import { z } from "zod";

export const GenerateRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required").max(65536, "prompt too long"),
  temperature: z.number().min(0).max(2).optional(),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const PlanRequestSchema = z.preprocess(
  (data: unknown) => {
    if (typeof data === "object" && data !== null) {
      const obj = data as Record<string, unknown>;
      if (!obj.goal && typeof obj.prompt === "string") {
        return { ...obj, goal: obj.prompt };
      }
    }
    return data;
  },
  z.object({
    goal: z.string().min(1, "goal is required").max(65536, "goal too long"),
    execute: z.boolean().optional().default(false),
    autoApprove: z.boolean().optional().default(false),
  }),
);

export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const DebugCIRequestSchema = z.object({
  log: z.string().min(1, "log is required").max(262144, "log too long"),
});

export type DebugCIRequest = z.infer<typeof DebugCIRequestSchema>;

export const DiffRequestSchema = z
  .object({
    diff: z.string().min(1, "diff is required").max(262144, "diff too long"),
    before: z.string().max(262144, "before too long").optional(),
    after: z.string().max(262144, "after too long").optional(),
  })
  .refine((data) => (!data.before && !data.after) || (data.before && data.after), {
    message: "'before' and 'after' must both be provided, or both omitted",
  });

export type DiffRequest = z.infer<typeof DiffRequestSchema>;

export const ScanRequestSchema = z.object({
  target: z.string().max(2048, "Path too long").optional(),
  scanType: z.enum(["all", "security", "deps", "iac", "sbom", "license"]).optional().default("all"),
  context: z
    .object({
      primaryLanguage: z.string().optional(),
      languages: z.array(z.object({ name: z.string() })).optional(),
      packageManager: z.object({ name: z.string() }).optional(),
      infra: z
        .object({
          hasTerraform: z.boolean().optional(),
          hasKubernetes: z.boolean().optional(),
          hasHelm: z.boolean().optional(),
          hasAnsible: z.boolean().optional(),
        })
        .optional(),
      container: z.object({ hasDockerfile: z.boolean().optional() }).optional(),
      scripts: z.object({ shellScripts: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});

export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const ChatRequestSchema = z.object({
  sessionId: z.string().max(64, "sessionId too long").optional(),
  message: z.string().min(1, "message is required").max(65536, "message too long"),
  agent: z.string().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatSessionRequestSchema = z.object({
  name: z.string().optional(),
  mode: z.enum(["INTERACTIVE", "DETERMINISTIC"]).optional().default("INTERACTIVE"),
});

export type ChatSessionRequest = z.infer<typeof ChatSessionRequestSchema>;

export const ReviewRequestSchema = z.object({
  /** Files to review. If empty/omitted AND autoDiscover is true, scans the project. */
  files: z
    .array(
      z.object({
        path: z.string().min(1, "file path is required"),
        content: z.string().optional(),
      }),
    )
    .max(100, "too many files (max 100)")
    .optional()
    .default([]),
  /** Auto-discover DevOps config files in the project directory. Default: true. */
  autoDiscover: z.boolean().optional().default(true),
  /** Use Context7 for documentation augmentation. */
  useContext7: z.boolean().optional().default(false),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const AutoRequestSchema = z.object({
  prompt: z.string().min(1, "prompt is required").max(65536, "prompt too long"),
  maxIterations: z.number().min(1).max(50).optional().default(20),
  background: z.boolean().optional().default(false),
});

export type AutoRequest = z.infer<typeof AutoRequestSchema>;
