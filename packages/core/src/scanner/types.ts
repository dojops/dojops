import { z } from "zod";

// ── Sub-schemas ─────────────────────────────────────────────────────

export const LanguageDetectionSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
  indicator: z.string(),
});

export const PackageManagerSchema = z.object({
  name: z.string(),
  lockfile: z.string().optional(),
});

export const CIDetectionSchema = z.object({
  platform: z.string(),
  configPath: z.string(),
});

export const ContainerDetectionSchema = z.object({
  hasDockerfile: z.boolean(),
  hasCompose: z.boolean(),
  composePath: z.string().optional(),
  hasSwarm: z.boolean().optional(),
});

export const InfraDetectionSchema = z.object({
  hasTerraform: z.boolean(),
  tfProviders: z.array(z.string()),
  hasState: z.boolean(),
  hasKubernetes: z.boolean(),
  hasHelm: z.boolean(),
  hasAnsible: z.boolean(),
  hasKustomize: z.boolean(),
  hasVagrant: z.boolean(),
  hasPulumi: z.boolean(),
  hasCloudFormation: z.boolean(),
  hasPacker: z.boolean().optional(),
});

export const MonitoringDetectionSchema = z.object({
  hasPrometheus: z.boolean(),
  hasNginx: z.boolean(),
  hasSystemd: z.boolean(),
  hasHaproxy: z.boolean(),
  hasTomcat: z.boolean(),
  hasApache: z.boolean(),
  hasCaddy: z.boolean(),
  hasEnvoy: z.boolean(),
});

export const ScriptsDetectionSchema = z.object({
  shellScripts: z.array(z.string()),
  pythonScripts: z.array(z.string()),
  hasJustfile: z.boolean(),
});

export const SecurityDetectionSchema = z.object({
  hasEnvExample: z.boolean(),
  hasGitignore: z.boolean(),
  hasCodeowners: z.boolean(),
  hasSecurityPolicy: z.boolean(),
  hasDependabot: z.boolean(),
  hasRenovate: z.boolean(),
  hasSecretScanning: z.boolean(),
  hasEditorConfig: z.boolean(),
});

export const MetadataSchema = z.object({
  isGitRepo: z.boolean(),
  isMonorepo: z.boolean(),
  hasMakefile: z.boolean(),
  hasReadme: z.boolean(),
  hasEnvFile: z.boolean(),
});

// ── LLM Insights schema ─────────────────────────────────────────────

const AgentEntrySchema = z.union([
  z.string(),
  z.record(z.unknown()).transform((o) => {
    // Try common field names the LLM might use
    for (const key of ["name", "agent", "agentName", "value", "id"]) {
      if (typeof o[key] === "string") return o[key] as string;
    }
    // Fall back to first string value
    const first = Object.values(o).find((v) => typeof v === "string");
    return (first as string) ?? "unknown";
  }),
]);

export const LLMInsightsSchema = z.object({
  projectDescription: z.string().optional().default(""),
  techStack: z.array(z.string()).optional().default([]),
  suggestedWorkflows: z
    .array(
      z.object({
        command: z.string(),
        description: z.string(),
      }),
    )
    .optional()
    .default([]),
  recommendedAgents: z.array(AgentEntrySchema).optional().default([]),
  notes: z.string().optional(),
});

// ── Main schemas (V1 + V2) ──────────────────────────────────────────

export const RepoContextSchemaV1 = z.object({
  version: z.literal(1),
  scannedAt: z.string(),
  rootPath: z.string(),
  languages: z.array(LanguageDetectionSchema),
  primaryLanguage: z.string().nullable(),
  packageManager: PackageManagerSchema.nullable(),
  ci: z.array(CIDetectionSchema),
  container: ContainerDetectionSchema,
  infra: InfraDetectionSchema.pick({
    hasTerraform: true,
    tfProviders: true,
    hasState: true,
    hasKubernetes: true,
    hasHelm: true,
    hasAnsible: true,
  }),
  monitoring: MonitoringDetectionSchema.pick({
    hasPrometheus: true,
    hasNginx: true,
    hasSystemd: true,
  }),
  meta: MetadataSchema,
  relevantDomains: z.array(z.string()),
  llmInsights: LLMInsightsSchema.optional(),
});

export const RepoContextSchemaV2 = z.object({
  version: z.literal(2),
  scannedAt: z.string(),
  rootPath: z.string(),
  languages: z.array(LanguageDetectionSchema),
  primaryLanguage: z.string().nullable(),
  packageManager: PackageManagerSchema.nullable(),
  ci: z.array(CIDetectionSchema),
  container: ContainerDetectionSchema,
  infra: InfraDetectionSchema,
  monitoring: MonitoringDetectionSchema,
  scripts: ScriptsDetectionSchema,
  security: SecurityDetectionSchema,
  meta: MetadataSchema,
  relevantDomains: z.array(z.string()),
  devopsFiles: z.array(z.string()),
  llmInsights: LLMInsightsSchema.optional(),
});

export const RepoContextSchema = z.union([RepoContextSchemaV1, RepoContextSchemaV2]);

// ── Inferred types ──────────────────────────────────────────────────

export type LanguageDetection = z.infer<typeof LanguageDetectionSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type CIDetection = z.infer<typeof CIDetectionSchema>;
export type ContainerDetection = z.infer<typeof ContainerDetectionSchema>;
export type InfraDetection = z.infer<typeof InfraDetectionSchema>;
export type MonitoringDetection = z.infer<typeof MonitoringDetectionSchema>;
export type ScriptsDetection = z.infer<typeof ScriptsDetectionSchema>;
export type SecurityDetection = z.infer<typeof SecurityDetectionSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
export type LLMInsights = z.infer<typeof LLMInsightsSchema>;
export type RepoContextV1 = z.infer<typeof RepoContextSchemaV1>;
export type RepoContext = z.infer<typeof RepoContextSchemaV2>;
