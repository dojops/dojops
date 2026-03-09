import { z } from "zod";

// ── Input Field DSL ──────────────────────────────────

export interface InputFieldDef {
  type: "string" | "number" | "integer" | "boolean" | "enum" | "array" | "object";
  required?: boolean;
  description?: string;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  values?: string[];
  items?: InputFieldDef;
  minItems?: number;
  maxItems?: number;
  properties?: Record<string, InputFieldDef>;
}

const InputFieldBaseSchema: z.ZodType<InputFieldDef> = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "enum", "array", "object"]),
  required: z.boolean().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  // String constraints
  minLength: z.number().int().optional(),
  maxLength: z.number().int().optional(),
  pattern: z.string().optional(),
  // Number constraints
  min: z.number().optional(),
  max: z.number().optional(),
  // Enum values
  values: z.array(z.string()).optional(),
  // Array constraints
  items: z.lazy((): z.ZodType<InputFieldDef> => InputFieldSchema).optional(),
  minItems: z.number().int().optional(),
  maxItems: z.number().int().optional(),
  // Object shape
  properties: z
    .record(
      z.string(),
      z.lazy((): z.ZodType<InputFieldDef> => InputFieldSchema),
    )
    .optional(),
});

export const InputFieldSchema: z.ZodType<InputFieldDef> = InputFieldBaseSchema;

// ── Output Schema (JSON Schema in YAML) ─────────────

export interface OutputSchemaShape {
  type?: string;
  properties?: Record<string, OutputSchemaShape>;
  required?: string[];
  items?: OutputSchemaShape;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  anyOf?: OutputSchemaShape[];
  oneOf?: OutputSchemaShape[];
  format?: string;
  [key: string]: unknown;
}

export const OutputSchemaSchema: z.ZodType<OutputSchemaShape> = z.lazy(() =>
  z
    .object({
      type: z.string().optional(),
      properties: z.record(z.string(), OutputSchemaSchema).optional(),
      required: z.array(z.string()).optional(),
      items: OutputSchemaSchema.optional(),
      enum: z.array(z.unknown()).optional(),
      default: z.unknown().optional(),
      description: z.string().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      pattern: z.string().optional(),
      minItems: z.number().optional(),
      maxItems: z.number().optional(),
      anyOf: z.array(OutputSchemaSchema).optional(),
      oneOf: z.array(OutputSchemaSchema).optional(),
      format: z.string().optional(),
    })
    .passthrough(),
);

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

// ── File Output Spec ─────────────────────────────────

export const FileSpecSchema = z.object({
  path: z.string().min(1),
  format: z.enum(["hcl", "yaml", "json", "raw", "ini", "toml"]).default("raw"),
  source: z.enum(["llm", "template"]).default("llm"),
  content: z.string().optional(),
  multiDocument: z.boolean().optional(),
  dataPath: z.string().optional(),
  conditional: z.boolean().optional(),
  options: z
    .object({
      mapAttributes: z.array(z.string()).optional(),
      keyOrder: z.array(z.string()).optional(),
      sortKeys: z.boolean().optional(),
      lineWidth: z.number().int().optional(),
      noRefs: z.boolean().optional(),
      indent: z.number().int().optional(),
    })
    .optional(),
});

export type FileSpec = z.infer<typeof FileSpecSchema>;

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

// ── Frontmatter (YAML section) ───────────────────────

export const DopsFrontmatterSchema = z.object({
  dops: z.literal("v1"),
  kind: z.enum(["tool"]).default("tool"),
  meta: MetaSchema,
  input: z
    .object({
      fields: z.record(z.string(), InputFieldSchema),
    })
    .optional(),
  output: OutputSchemaSchema,
  files: z.array(FileSpecSchema).min(1),
  detection: DetectionConfigSchema.optional(),
  verification: VerificationConfigSchema.optional(),
  permissions: PermissionsSchema.optional(),
  scope: ScopeSchema.optional(),
  risk: RiskSchema.optional(),
  execution: ExecutionSchema.optional(),
  update: UpdateSchema.optional(),
  capabilities: CapabilitiesSchema.optional(),
});

export type DopsFrontmatter = z.infer<typeof DopsFrontmatterSchema>;

// ── Markdown Sections ────────────────────────────────

export interface MarkdownSections {
  prompt: string;
  updatePrompt?: string;
  examples?: string;
  constraints?: string;
  keywords: string;
}

// ── Complete DOPS Module ─────────────────────────────

export interface DopsModule {
  frontmatter: DopsFrontmatter;
  sections: MarkdownSections;
  raw: string;
}

// ── Validation Result ────────────────────────────────

export interface DopsValidationResult {
  valid: boolean;
  errors?: string[];
}

// ══════════════════════════════════════════════════════
// v2 Format Schemas
// ══════════════════════════════════════════════════════

// ── Context7 Library Reference ───────────────────────

export const Context7LibraryRefSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
});

export type Context7LibraryRef = z.infer<typeof Context7LibraryRefSchema>;

// ── Context Block (replaces input + output in v2) ────

export const ContextBlockSchema = z.object({
  technology: z.string().min(1),
  fileFormat: z.enum(["yaml", "hcl", "json", "raw", "ini", "toml"]),
  outputGuidance: z.string().min(1),
  bestPractices: z.array(z.string().min(1)).min(1),
  context7Libraries: z.array(Context7LibraryRefSchema).optional(),
});

export type ContextBlock = z.infer<typeof ContextBlockSchema>;

// ── v2 File Spec (always raw) ────────────────────────

export const FileSpecV2Schema = z.object({
  path: z.string().min(1),
  format: z.literal("raw").default("raw"),
  conditional: z.boolean().optional(),
});

export type FileSpecV2 = z.infer<typeof FileSpecV2Schema>;

// ── v2 Frontmatter ──────────────────────────────────

export const DopsFrontmatterV2Schema = z.object({
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
});

export type DopsFrontmatterV2 = z.infer<typeof DopsFrontmatterV2Schema>;

// ── v2 Complete Module ──────────────────────────────

export interface DopsModuleV2 {
  frontmatter: DopsFrontmatterV2;
  sections: MarkdownSections;
  raw: string;
}

// ── Version-agnostic union ──────────────────────────

export type DopsModuleAny = DopsModule | DopsModuleV2;

export function isV2Module(mod: DopsModuleAny): mod is DopsModuleV2 {
  return mod.frontmatter.dops === "v2";
}
