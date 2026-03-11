// Spec types
export {
  DopsModule,
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
} from "./spec";

// Parser
export { parseDopsFile, parseDopsString, validateDopsModule } from "./parser";

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

// Runtime v2
export {
  DopsRuntimeV2,
  DopsRuntimeV2Options,
  DocProvider,
  ToolMetadata,
  stripCodeFences,
  parseRawContent,
  parseMultiFileOutput,
} from "./runtime";
