// Spec types
export {
  DopsSkill,
  DopsFrontmatter,
  DopsValidationResult,
  MarkdownSections,
  StructuralRule,
  BinaryVerificationConfig,
  VerificationConfig,
  DetectionConfig,
  DopsPermissions,
  DopsFrontmatterSchema,
  StructuralRuleSchema,
  BinaryVerificationSchema,
  VerificationConfigSchema,
  DetectionConfigSchema,
  PermissionsSchema,
  MetaSchema,
  ScopeSchema,
  DopsScope,
  RiskSchema,
  DopsRisk,
  ExecutionSchema,
  DopsExecution,
  UpdateSchema,
  DopsUpdate,
  Context7LibraryRefSchema,
  Context7LibraryRef,
  ContextBlockSchema,
  ContextBlock,
  FileSpecV2Schema,
  FileSpecV2,
  SkillDependencySchema,
  SkillDependency,
} from "./spec";

// Dependency resolver
export { resolveSkillDependencies } from "./dependency-resolver";
export type { DependencyResult, SkillLookup } from "./dependency-resolver";

// Parser
export { parseDopsFile, parseDopsString, validateDopsSkill } from "./parser";

// Schema compiler
export { compileOutputSchema, jsonSchemaToZod, JSONSchemaObject } from "./schema-compiler";

// Prompt compiler (v2)
export { compilePromptV2, PromptContextV2 } from "./prompt-compiler";

// Serializer
export { serialize, SerializerOptions } from "./serializer";

// Structural validator
export { validateStructure } from "./structural-validator";

// Binary verifier
export {
  verifyWithBinary,
  runVerification,
  BinaryVerifierInput,
  RunVerificationOptions,
  ALLOWED_VERIFICATION_BINARIES,
} from "./binary-verifier";

// File writer
export {
  writeFiles,
  serializeForFile,
  detectExistingContent,
  resolveFilePath,
  matchesScopePattern,
  WriteResult,
} from "./file-writer";

// Context7 Doc Auditor
export { auditAgainstDocs, DocAuditResult } from "./context7-doc-auditor";

// Review tool runner
export { runReviewTool, runReviewTools } from "./review-tool-runner";

// Parsers
export { getParser, getAvailableParsers, SeverityMapping } from "./parsers/index";

// Multi-file splitter
export { splitMultiFileOutput, isMultiFileSkill } from "./multi-file-splitter";
export type { SplitFile } from "./multi-file-splitter";

// Runtime v2
export {
  DopsRuntimeV2,
  DopsRuntimeV2Options,
  DocProvider,
  RuntimeFileWriter,
  ToolMetadata,
  SkillTrustLevel,
  stripCodeFences,
  parseRawContent,
  parseMultiFileOutput,
} from "./runtime";
