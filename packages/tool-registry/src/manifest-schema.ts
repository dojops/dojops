import { z } from "zod";
import * as path from "path";

const noPathTraversal = (val: string) => !val.split(/[/\\]/).includes("..");
const isRelativePath = (val: string) => !path.isAbsolute(val);

const FileEntrySchema = z.object({
  path: z.string().min(1).refine(noPathTraversal, "Path must not contain '..' traversal segments"),
  serializer: z.enum(["yaml", "json", "hcl", "ini", "toml", "raw"]),
});

const GeneratorSchema = z.object({
  strategy: z.literal("llm"),
  systemPrompt: z.string().min(1),
  updateMode: z.boolean().optional(),
  existingDelimiter: z.string().optional(),
});

const VerificationSchema = z.object({
  command: z.string().min(1),
});

const DetectorSchema = z.object({
  path: z.string().min(1).refine(noPathTraversal, "Path must not contain '..' traversal segments"),
});

const PermissionsSchema = z.object({
  filesystem: z.enum(["project", "global"]).optional(),
  network: z.enum(["none", "inherit"]).optional(),
  child_process: z.enum(["none", "required"]).optional(),
});

export const PluginManifestSchema = z.object({
  spec: z.number().int().min(1).max(1),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Plugin name must be lowercase alphanumeric with hyphens"),
  version: z.string().min(1),
  type: z.literal("tool"),
  description: z.string().min(1).max(500),
  inputSchema: z
    .string()
    .min(1)
    .refine(noPathTraversal, "inputSchema path must not contain '..' traversal segments")
    .refine(isRelativePath, "inputSchema must be a relative path"),
  outputSchema: z
    .string()
    .optional()
    .refine(
      (v) => v === undefined || noPathTraversal(v),
      "outputSchema path must not contain '..' traversal segments",
    )
    .refine((v) => v === undefined || isRelativePath(v), "outputSchema must be a relative path"),
  tags: z.array(z.string()).optional(),
  generator: GeneratorSchema,
  files: z.array(FileEntrySchema).min(1),
  verification: VerificationSchema.optional(),
  detector: DetectorSchema.optional(),
  permissions: PermissionsSchema.optional(),
});

export function validateManifest(data: unknown): {
  valid: boolean;
  manifest?: z.infer<typeof PluginManifestSchema>;
  error?: string;
} {
  const result = PluginManifestSchema.safeParse(data);
  if (result.success) {
    return { valid: true, manifest: result.data };
  }
  const messages = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  return { valid: false, error: messages.join("; ") };
}
