// Spec types
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
} from "./spec";

// Parser
export { parseDopsFile, parseDopsString, validateDopsModule } from "./parser";

// Schema compiler
export {
  compileInputSchema,
  compileOutputSchema,
  jsonSchemaToZod,
  JSONSchemaObject,
} from "./schema-compiler";

// Prompt compiler
export { compilePrompt, PromptContext } from "./prompt-compiler";

// Serializer
export { serialize, SerializerOptions } from "./serializer";

// Structural validator
export { validateStructure } from "./structural-validator";

// Binary verifier
export { verifyWithBinary, runVerification, BinaryVerifierInput } from "./binary-verifier";

// File writer
export { writeFiles, serializeForFile, detectExistingContent, WriteResult } from "./file-writer";

// Parsers
export { getParser, getAvailableParsers, SeverityMapping } from "./parsers/index";

// Runtime (core class)
export { DopsRuntime, DopsRuntimeOptions, ToolMetadata } from "./runtime";
