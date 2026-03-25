import { z } from "zod";

// ── Structural Validation Rule ───────────────────────

export const StructuralRuleSchema = z.object({
  path: z.string(),
  required: z.boolean().optional(),
  type: z.string().optional(),
  minItems: z.number().int().optional(),
  message: z.string(),
  requiredUnless: z.string().optional(),
});

export type StructuralRule = z.infer<typeof StructuralRuleSchema>;

// ── Binary Verification Config ───────────────────────

export const BinaryVerificationSchema = z.object({
  command: z.string().min(1),
  parser: z.string().min(1),
  timeout: z.number().int().positive().default(30000),
  cwd: z.enum(["output", "tool"]).default("output"),
});

export type BinaryVerificationConfig = z.infer<typeof BinaryVerificationSchema>;

// ── Severity Mapping ─────────────────────────────────

export const SeverityMappingSchema = z.object({
  error: z.array(z.string()).optional(),
  warning: z.array(z.string()).optional(),
  info: z.array(z.string()).optional(),
});

// ── Verification Config ──────────────────────────────

export const VerificationConfigSchema = z.object({
  structural: z.array(StructuralRuleSchema).optional(),
  binary: BinaryVerificationSchema.optional(),
  severity: SeverityMappingSchema.optional(),
});

export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;

// ── Detection Config ─────────────────────────────────

export const DetectionConfigSchema = z.object({
  paths: z.array(z.string()).min(1),
  updateMode: z.boolean().default(true),
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

// ── Permissions ──────────────────────────────────────

export const PermissionsSchema = z.object({
  filesystem: z.enum(["read", "write"]).default("write"),
  child_process: z.enum(["required", "none"]).default("none"),
  network: z.enum(["none", "required"]).default("none"),
});

export type DopsPermissions = z.infer<typeof PermissionsSchema>;

// ── Skill Dependencies ──────────────────────────────
export const SkillDependencySchema = z.object({
  skill: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/),
  optional: z.boolean().default(false),
});

export type SkillDependency = z.infer<typeof SkillDependencySchema>;

// ── Meta ─────────────────────────────────────────────

export const MetaSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().min(1),
  description: z.string().min(1).max(500),
  author: z.string().optional(),
  license: z.string().optional(),
  tags: z.array(z.string()).optional(),
  repository: z.string().optional(),
  icon: z
    .string()
    .url()
    .max(2048)
    .refine((url) => url.startsWith("https://"), { message: "Icon URL must use HTTPS" })
    .optional(),
});

// ── Scope ───────────────────────────────────────────

export const ScopeSchema = z.object({
  write: z.array(z.string().min(1)).min(1),
});

export type DopsScope = z.infer<typeof ScopeSchema>;

// ── Risk ────────────────────────────────────────────

export const RiskSchema = z.object({
  level: z.enum(["LOW", "MEDIUM", "HIGH"]),
  rationale: z.string().min(1).max(500),
});

export type DopsRisk = z.infer<typeof RiskSchema>;

// ── Execution ───────────────────────────────────────

export const ExecutionSchema = z.object({
  mode: z.enum(["generate", "update"]).default("generate"),
  deterministic: z.boolean().default(false),
  idempotent: z.boolean().default(false),
});

export type DopsExecution = z.infer<typeof ExecutionSchema>;

// ── Update ──────────────────────────────────────────

export const UpdateSchema = z.object({
  strategy: z.enum(["replace", "preserve_structure"]).default("replace"),
  inputSource: z.enum(["file"]).default("file"),
  injectAs: z.string().default("existingContent"),
});

// ── Capabilities (tool metadata for planner/scheduler) ──

export const CapabilitiesSchema = z.object({
  /** What external effects this tool has when executed. */
  sideEffects: z.enum(["none", "filesystem", "network", "process"]).default("filesystem"),
  /** Expected execution time category for scheduling optimization. */
  runtime: z.enum(["short", "long"]).default("short"),
});

export type DopsCapabilities = z.infer<typeof CapabilitiesSchema>;

export type DopsUpdate = z.infer<typeof UpdateSchema>;

// ── Markdown Sections ────────────────────────────────

export interface MarkdownSections {
  prompt: string;
  updatePrompt?: string;
  examples?: string;
  constraints?: string;
  keywords: string;
}

// ── Validation Result ────────────────────────────────

export interface DopsValidationResult {
  valid: boolean;
  errors?: string[];
}

// ── Context7 Library Reference ───────────────────────

export const Context7LibraryRefSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
});

export type Context7LibraryRef = z.infer<typeof Context7LibraryRefSchema>;

// ── Context Block ────────────────────────────────────

export const ContextBlockSchema = z.object({
  technology: z.string().min(1),
  fileFormat: z.enum(["yaml", "hcl", "json", "raw", "ini", "toml"]),
  outputGuidance: z.string().min(1),
  bestPractices: z.array(z.string().min(1)).min(1),
  context7Libraries: z.array(Context7LibraryRefSchema).optional(),
});

export type ContextBlock = z.infer<typeof ContextBlockSchema>;

// ── File Spec (always raw) ───────────────────────────

export const FileSpecV2Schema = z.object({
  path: z.string().min(1),
  format: z.literal("raw").default("raw"),
  conditional: z.boolean().optional(),
});

export type FileSpecV2 = z.infer<typeof FileSpecV2Schema>;

// ── Frontmatter ──────────────────────────────────────

export const DopsFrontmatterSchema = z.object({
  dops: z.literal("v2"),
  kind: z.enum(["tool"]).default("tool"),
  meta: MetaSchema,
  context: ContextBlockSchema,
  files: z.array(FileSpecV2Schema).min(1),
  detection: DetectionConfigSchema.optional(),
  verification: VerificationConfigSchema.optional(),
  permissions: PermissionsSchema.optional(),
  scope: ScopeSchema.optional(),
  risk: RiskSchema.optional(),
  execution: ExecutionSchema.optional(),
  update: UpdateSchema.optional(),
  capabilities: CapabilitiesSchema.optional(),
  dependencies: z.array(SkillDependencySchema).optional(),
});

export type DopsFrontmatter = z.infer<typeof DopsFrontmatterSchema>;

// ── Complete DOPS Skill ─────────────────────────────

export interface DopsSkill {
  frontmatter: DopsFrontmatter;
  sections: MarkdownSections;
  raw: string;
}
