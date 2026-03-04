// Spec types (v1)
export {
  DopsModule,
  DopsFrontmatter,
  DopsValidationResult,
  MarkdownSections,
  InputFieldDef,
  StructuralRule,
  BinaryVerificationConfig,
  VerificationConfig,
  FileSpec,
  DetectionConfig,
  DopsPermissions,
  DopsFrontmatterSchema,
  StructuralRuleSchema,
  BinaryVerificationSchema,
  VerificationConfigSchema,
  FileSpecSchema,
  DetectionConfigSchema,
  PermissionsSchema,
  MetaSchema,
  OutputSchemaSchema,
  ScopeSchema,
  DopsScope,
  RiskSchema,
  DopsRisk,
  ExecutionSchema,
  DopsExecution,
  UpdateSchema,
  DopsUpdate,
} from "./spec";

// Spec types (v2)
export {
  Context7LibraryRefSchema,
  Context7LibraryRef,
  ContextBlockSchema,
  ContextBlock,
  FileSpecV2Schema,
  FileSpecV2,
  DopsFrontmatterV2Schema,
  DopsFrontmatterV2,
  DopsModuleV2,
  DopsModuleAny,
  isV2Module,
} from "./spec";

// Parser (v1)
export { parseDopsFile, parseDopsString, validateDopsModule } from "./parser";

// Parser (v2)
export {
  parseDopsFileAny,
  parseDopsStringAny,
  validateDopsModuleV2,
  validateDopsModuleAny,
} from "./parser";

// Schema compiler
export {
  compileInputSchema,
  compileOutputSchema,
  jsonSchemaToZod,
  JSONSchemaObject,
} from "./schema-compiler";

// Prompt compiler (v1)
export { compilePrompt, PromptContext } from "./prompt-compiler";

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

// Parsers
export { getParser, getAvailableParsers, SeverityMapping } from "./parsers/index";

// Runtime v1 (core class)
export { DopsRuntime, DopsRuntimeOptions, ToolMetadata } from "./runtime";

// Runtime v2
export {
  DopsRuntimeV2,
  DopsRuntimeV2Options,
  DocProvider,
  stripCodeFences,
  parseRawContent,
} from "./runtime";
