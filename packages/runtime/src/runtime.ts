import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { LLMProvider, parseAndValidate } from "@dojops/core";
import type { DevOpsTool, ToolOutput, VerificationResult, VerificationIssue } from "@dojops/sdk";
import { z } from "zod";
import {
  DopsExecution,
  DopsModule,
  DopsModuleV2,
  DopsRisk,
  FileSpec,
  FileSpecV2,
  Context7LibraryRef,
} from "./spec";
import { compileInputSchema, compileOutputSchema } from "./schema-compiler";
import { compilePrompt, PromptContext, compilePromptV2, PromptContextV2 } from "./prompt-compiler";
import { validateStructure } from "./structural-validator";
import { runVerification } from "./binary-verifier";
import {
  writeFiles,
  serializeForFile,
  detectExistingContent,
  resolveFilePath,
  matchesScopePattern,
} from "./file-writer";
import { auditAgainstDocs } from "./context7-doc-auditor";

/** Compute SHA-256 hex hash of a string. */
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Compute hashes for a DopsModule (v1 or v2). */
function computeModuleHashes(module: { sections: { prompt: string }; raw: string }): {
  systemPromptHash: string;
  moduleHash: string;
} {
  return {
    systemPromptHash: sha256(module.sections.prompt),
    moduleHash: sha256(module.raw),
  };
}

/** Detect existing content from a module's detection config. */
function detectContent(
  detection: { paths: string[] } | undefined,
  existingContent: string | undefined,
  basePath: string,
): string | undefined {
  if (existingContent) return existingContent;
  if (!detection) return undefined;
  return detectExistingContent(detection.paths, basePath) ?? undefined;
}

export interface DopsRuntimeOptions {
  /** Base path for file detection (defaults to cwd) */
  basePath?: string;
  /** Optional documentation augmenter for injecting up-to-date docs into prompts */
  docAugmenter?: {
    augmentPrompt(s: string, kw: string[], q: string): Promise<string>;
  };
}

export interface ToolMetadata {
  toolType: "built-in" | "custom";
  toolVersion: string;
  toolHash: string;
  toolSource: string;
  systemPromptHash: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  icon?: string;
}

// ── Shared helpers for DopsRuntime and DopsRuntimeV2 ──

function validateInput(schema: z.ZodType, input: unknown): { valid: boolean; error?: string } {
  const result = schema.safeParse(input);
  if (result.success) return { valid: true };
  return { valid: false, error: result.error.message };
}

function failedOutput(err: unknown): ToolOutput {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

/** Strip {outputPath}/ template prefix or resolved outputPath prefix from a file path. */
function stripOutputPrefix(p: string, outputPath: string): string {
  if (p.startsWith("{outputPath}/")) return p.slice("{outputPath}/".length);
  if (outputPath && p.startsWith(outputPath + "/")) return p.slice(outputPath.length + 1);
  return p;
}

const DEFAULT_RISK: DopsRisk = { level: "LOW", rationale: "No risk classification declared" };

function getRisk(frontmatter: { risk?: DopsRisk }): DopsRisk {
  return frontmatter.risk ?? DEFAULT_RISK;
}

const DEFAULT_EXECUTION: DopsExecution = {
  mode: "generate",
  deterministic: false,
  idempotent: false,
};

function getExecutionMode(frontmatter: { execution?: DopsExecution }): DopsExecution {
  return frontmatter.execution ?? DEFAULT_EXECUTION;
}

function parseKeywords(keywordsStr: string): string[] {
  return keywordsStr
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/** Build standard ToolMetadata from a parsed .dops module. */
function buildToolMetadata(
  frontmatter: { meta: { version: string; icon?: string }; risk?: DopsRisk },
  moduleHash: string,
  systemPromptHash: string,
): ToolMetadata {
  return {
    toolType: "built-in",
    toolVersion: frontmatter.meta.version,
    toolHash: moduleHash,
    toolSource: "dops",
    systemPromptHash,
    riskLevel: getRisk(frontmatter).level,
    icon: frontmatter.meta.icon,
  };
}

/**
 * DopsRuntime: The unified tool runtime engine.
 * Processes all tools — built-in .dops modules and user .dops files — through one code path.
 */
export class DopsRuntime implements DevOpsTool<Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;

  private readonly module: DopsModule;
  private readonly provider: LLMProvider;
  private readonly outputSchema: z.ZodType;
  private readonly options: DopsRuntimeOptions;
  private readonly _systemPromptHash: string;
  private readonly _moduleHash: string;

  constructor(module: DopsModule, provider: LLMProvider, options?: DopsRuntimeOptions) {
    this.module = module;
    this.provider = provider;
    this.options = options ?? {};

    this.name = module.frontmatter.meta.name;
    this.description = module.frontmatter.meta.description;

    // Compile input schema from DSL fields
    this.inputSchema = module.frontmatter.input
      ? compileInputSchema(module.frontmatter.input.fields)
      : compileInputSchema({});

    // Compile output schema from JSON Schema in YAML
    this.outputSchema = compileOutputSchema(module.frontmatter.output as Record<string, unknown>);

    const hashes = computeModuleHashes(module);
    this._systemPromptHash = hashes.systemPromptHash;
    this._moduleHash = hashes.moduleHash;
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    return validateInput(this.inputSchema, input);
  }

  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      // 1. Detect existing content
      const basePath = this.options.basePath ?? process.cwd();
      const existingContent = detectContent(
        this.module.frontmatter.detection,
        input.existingContent as string | undefined,
        basePath,
      );

      // 2. Compile prompt
      const context: PromptContext = {
        existingContent,
        input,
        updateConfig: this.module.frontmatter.update,
      };
      let systemPrompt = compilePrompt(this.module.sections, context);

      // 2b. Augment with documentation if available
      if (this.options.docAugmenter) {
        try {
          const keywords = this.keywords.slice(0, 3);
          const userPrompt = this.buildUserPrompt(input, !!existingContent);
          systemPrompt = await this.options.docAugmenter.augmentPrompt(
            systemPrompt,
            keywords,
            userPrompt,
          );
        } catch {
          // Graceful degradation: proceed without docs
        }
      }

      // 3. Build user prompt
      const isUpdate = !!existingContent;
      const userPrompt = this.buildUserPrompt(input, isUpdate);

      // 4. Call LLM with output schema
      const response = await this.provider.generate({
        system: systemPrompt,
        prompt: userPrompt,
        schema: this.outputSchema,
      });

      // 5. Enforce output validation — NEVER accept raw strings
      let data: unknown;
      if (response.parsed) {
        // Provider already parsed and validated
        data = response.parsed;
      } else {
        data = parseAndValidate(response.content, this.outputSchema);
      }

      return {
        success: true,
        data: { generated: data, isUpdate },
        usage: response.usage,
      };
    } catch (err) {
      return failedOutput(err);
    }
  }

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    // 1. Generate
    const genResult = await this.generate(input);
    if (!genResult.success || !genResult.data) return genResult;

    const { generated, isUpdate } = genResult.data as {
      generated: unknown;
      isUpdate: boolean;
    };

    try {
      // 2. Write files (with optional scope enforcement)
      const writeResult = writeFiles(
        generated,
        this.module.frontmatter.files,
        input,
        isUpdate,
        this.module.frontmatter.scope,
      );

      return {
        success: true,
        data: { generated, isUpdate },
        filesWritten: writeResult.filesWritten,
        filesModified: writeResult.filesModified,
        usage: genResult.usage,
      };
    } catch (err) {
      return failedOutput(err);
    }
  }

  async verify(data: unknown): Promise<VerificationResult> {
    const verificationConfig = this.module.frontmatter.verification;
    const permissions = this.module.frontmatter.permissions ?? {};

    // Run structural validation
    const structuralIssues: VerificationIssue[] = verificationConfig?.structural
      ? validateStructure(data, verificationConfig.structural)
      : [];

    // For binary verification, serialize the content first
    let serializedContent = "";
    let filename = "output";

    if (verificationConfig?.binary && this.module.frontmatter.files.length > 0) {
      const primaryFile = this.module.frontmatter.files[0];
      serializedContent = serializeForFile(data, primaryFile);

      // Extract filename from path template (use a reasonable default)
      const pathParts = primaryFile.path.split("/");
      filename = pathParts[pathParts.length - 1].replace(/\{[^}]+\}/g, "output"); // NOSONAR
    }

    return runVerification(
      data,
      serializedContent,
      filename,
      verificationConfig,
      permissions,
      structuralIssues,
      this.name,
    );
  }

  get systemPromptHash(): string {
    return this._systemPromptHash;
  }

  get moduleHash(): string {
    return this._moduleHash;
  }

  get metadata(): ToolMetadata {
    return buildToolMetadata(this.module.frontmatter, this._moduleHash, this._systemPromptHash);
  }

  get risk(): DopsRisk {
    return getRisk(this.module.frontmatter);
  }

  get executionMode(): DopsExecution {
    return getExecutionMode(this.module.frontmatter);
  }

  get isDeterministic(): boolean {
    return this.executionMode.deterministic;
  }

  get isIdempotent(): boolean {
    return this.executionMode.idempotent;
  }

  get keywords(): string[] {
    return parseKeywords(this.module.sections.keywords);
  }

  get fileSpecs(): FileSpec[] {
    return this.module.frontmatter.files;
  }

  private buildUserPrompt(input: Record<string, unknown>, isUpdate: boolean): string {
    const action = isUpdate ? "Update" : "Generate";
    const parts: string[] = [`${action} configuration with the following parameters:`];

    for (const [key, value] of Object.entries(input)) {
      if (key === "existingContent") continue;
      if (value === undefined || value === null) continue;
      parts.push(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }

    return parts.join("\n");
  }
}

// ══════════════════════════════════════════════════════
// v2 Runtime — Raw content generation
// ══════════════════════════════════════════════════════

/**
 * Duck-typed interface for Context7 DocProvider.
 * Avoids hard import dependency on @dojops/context.
 */
export interface DocProvider {
  resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
  queryDocs(libraryId: string, query: string): Promise<string>;
}

export interface DopsRuntimeV2Options extends DopsRuntimeOptions {
  context7Provider?: DocProvider;
  projectContext?: string;
  /** Callback to auto-install a missing verification binary. */
  onBinaryMissing?: import("@dojops/core").OnBinaryMissing;
}

/**
 * Strip markdown code fences from LLM output.
 * Handles ```lang ... ``` and ~~~ ... ~~~ wrappers.
 */
export function stripCodeFences(content: string): string {
  const trimmed = content.trim();

  // Match ```<optional-lang>\n...\n``` or ~~~<optional-lang>\n...\n~~~ (anchored to start/end)
  const fenceMatch = /^(?:```|~~~)\w*\n([\s\S]*?)\n(?:```|~~~)$/.exec(trimmed);
  if (fenceMatch) {
    return fenceMatch[1];
  }

  // Ollama/local models often include preamble text before/after fenced code blocks.
  // Extract the fenced block from anywhere in the output.
  const innerMatch = /(?:```|~~~)\w*\n([\s\S]*?)\n(?:```|~~~)/.exec(trimmed);
  if (innerMatch) {
    return innerMatch[1];
  }

  return trimmed;
}

/**
 * Parse a JSON-keyed multi-file LLM output.
 *
 * Expected format: `{ "files": { "path": "content", ... } }`
 * Also accepts flat format: `{ "path": "content", ... }` as a fallback.
 * Returns a map of file paths to their string contents.
 */
/**
 * Escape raw control characters (U+0000–U+001F) inside JSON string values.
 * Uses a state machine to distinguish string interiors from structural JSON.
 */
function escapeControlCharsInStrings(json: string): string {
  const out: string[] = [];
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString) {
      if (ch === "\\") {
        // Escaped pair — copy both characters verbatim
        out.push(ch);
        i++;
        if (i < json.length) out.push(json[i]);
        continue;
      }
      if (ch === '"') {
        inString = false;
        out.push(ch);
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        // Raw control character inside a string — escape it
        switch (code) {
          case 0x08:
            out.push("\\b");
            break;
          case 0x09:
            out.push("\\t");
            break;
          case 0x0a:
            out.push("\\n");
            break;
          case 0x0c:
            out.push("\\f");
            break;
          case 0x0d:
            out.push("\\r");
            break;
          default:
            out.push(`\\u${code.toString(16).padStart(4, "0")}`);
            break;
        }
        continue;
      }
      out.push(ch);
    } else {
      if (ch === '"') inString = true;
      out.push(ch);
    }
  }
  return out.join("");
}

/**
 * Repair common invalid JSON produced by LLMs:
 * 1. Line continuations: `\` followed by a literal newline (+ optional whitespace)
 *    — LLMs break long JSON strings across lines for "readability"
 * 2. Invalid escape sequences: `\:`, `\-` etc. inside JSON strings
 *    — only valid JSON escapes are: \" \\ \/ \b \f \n \r \t \uXXXX
 * 3. Raw control characters (tabs, newlines) inside JSON string values
 *    — LLMs embed literal newlines in YAML/config content instead of \n
 */
function repairJsonEscapes(raw: string): string {
  // 1. Remove line continuations: backslash + literal newline + optional whitespace
  let repaired = raw.replace(/\\\n\s*/g, "");
  // 2. Remove invalid escape sequences (backslash NOT followed by valid escape char)
  repaired = repaired.replace(/\\(?!["\\/bfnrtu])/g, "");
  // 3. Escape raw control characters inside JSON string values
  repaired = escapeControlCharsInStrings(repaired);
  return repaired;
}

export function parseMultiFileOutput(raw: string): Record<string, string> {
  const stripped = stripCodeFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Attempt repair of invalid escape sequences and retry
    try {
      parsed = JSON.parse(repairJsonEscapes(stripped));
    } catch {
      throw new Error(
        "Multi-file output must be valid JSON. The LLM returned non-JSON content. " +
          "First 200 chars: " +
          stripped.slice(0, 200),
      );
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Multi-file output must be a JSON object with file paths as keys.");
  }

  const obj = parsed as Record<string, unknown>;

  // Preferred format: { "files": { "path": "content" } }
  const filesObj =
    typeof obj.files === "object" && obj.files !== null && !Array.isArray(obj.files)
      ? (obj.files as Record<string, unknown>)
      : obj;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(filesObj)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }

  if (Object.keys(result).length === 0) {
    throw new Error(
      'Multi-file output JSON must have string values. Expected: { "files": { "main.tf": "content..." } }',
    );
  }

  return result;
}

// ── Post-generation validation ────────────────────────────────────

/** Path traversal patterns that indicate potentially malicious or broken output. */
const UNSAFE_PATH_PATTERNS = [
  /\.\.\//, // Parent directory traversal
  /^\/(?!$)/, // Absolute paths (but allow "/" alone for root-relative)
  /[<>|"?*]/, // Invalid path characters
  /\0/, // Null bytes
];

/**
 * Validate generated file paths for safety and correctness.
 * Returns an array of error messages (empty = valid).
 */
export function validateGeneratedPaths(filePaths: string[]): string[] {
  const errors: string[] = [];
  for (const fp of filePaths) {
    if (!fp || fp.trim().length === 0) {
      errors.push("Empty file path in generated output");
      continue;
    }
    for (const pattern of UNSAFE_PATH_PATTERNS) {
      if (pattern.test(fp)) {
        errors.push(`Unsafe file path "${fp}" (matches ${pattern.source})`);
        break;
      }
    }
  }
  return errors;
}

/**
 * Validate generated content matches the expected format.
 * Returns an array of error messages (empty = valid).
 */
export function validateGeneratedContent(
  content: string,
  format: string,
  filename: string,
): string[] {
  const errors: string[] = [];
  if (!content || content.trim().length === 0) {
    errors.push(`Empty content for ${filename}`);
    return errors;
  }

  if (format === "yaml") {
    try {
      yaml.load(content);
    } catch (err) {
      errors.push(
        `Invalid YAML in ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (format === "json") {
    try {
      JSON.parse(content);
    } catch (err) {
      errors.push(
        `Invalid JSON in ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  // raw, hcl, ini, toml — no generic parse validation available
  return errors;
}

/**
 * Parse raw content into an object for structural validation.
 * Returns null for formats that can't be parsed (raw, ini, toml, hcl).
 */
export function parseRawContent(raw: string, format: string): unknown {
  try {
    if (format === "yaml") {
      return yaml.load(raw);
    }
    if (format === "json") {
      return JSON.parse(raw);
    }
  } catch {
    return null;
  }
  // hcl, raw, ini, toml — cannot parse generically
  return null;
}

/**
 * DopsRuntimeV2: The v2 tool runtime engine.
 * LLM generates raw file content instead of JSON objects.
 * Context7 libraries are declared in frontmatter and fetched at runtime.
 */
export class DopsRuntimeV2 implements DevOpsTool<Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;

  private readonly module: DopsModuleV2;
  private readonly provider: LLMProvider;
  private readonly options: DopsRuntimeV2Options;
  private readonly _systemPromptHash: string;
  private readonly _moduleHash: string;
  /** Cache of Context7 docs fetched during generate(), reused by verify(). */
  private _lastDocsCache: string = "";

  constructor(module: DopsModuleV2, provider: LLMProvider, options?: DopsRuntimeV2Options) {
    this.module = module;
    this.provider = provider;
    this.options = options ?? {};

    this.name = module.frontmatter.meta.name;
    this.description = module.frontmatter.meta.description;

    // v2: minimal input schema — prompt + existingContent + optional outputPath
    this.inputSchema = z.object({
      prompt: z.string().min(1),
      existingContent: z.string().optional(),
      outputPath: z.string().optional(),
    });

    const hashes = computeModuleHashes(module);
    this._systemPromptHash = hashes.systemPromptHash;
    this._moduleHash = hashes.moduleHash;
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    return validateInput(this.inputSchema, input);
  }

  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      // 1. Detect existing content
      const basePath = this.options.basePath ?? process.cwd();
      const existingContent = detectContent(
        this.module.frontmatter.detection,
        input.existingContent as string | undefined,
        basePath,
      );

      // 2. Fetch Context7 docs from declared libraries
      let context7Docs = "";
      if (this.options.context7Provider && this.module.frontmatter.context.context7Libraries) {
        context7Docs = await this.fetchContext7Docs(
          this.module.frontmatter.context.context7Libraries,
        );
      }
      // Cache docs for post-generation audit in verify()
      this._lastDocsCache = context7Docs;

      // 3. Compile prompt with v2 variables
      const promptContext: PromptContextV2 = {
        existingContent,
        updateConfig: this.module.frontmatter.update,
        context7Docs: context7Docs || undefined,
        projectContext: this.options.projectContext,
        contextBlock: this.module.frontmatter.context,
      };
      let systemPrompt = compilePromptV2(this.module.sections, promptContext);

      // 3b. Fallback: legacy docAugmenter if no Context7 provider
      if (!context7Docs && this.options.docAugmenter) {
        try {
          const keywords = this.keywords.slice(0, 3);
          systemPrompt = await this.options.docAugmenter.augmentPrompt(
            systemPrompt,
            keywords,
            input.prompt as string,
          );
        } catch {
          // Graceful degradation
        }
      }

      // 4. Build user prompt
      const isUpdate = !!existingContent;
      let userPrompt = isUpdate
        ? `Update the existing ${this.module.frontmatter.context.technology} configuration: ${input.prompt}`
        : `Generate ${this.module.frontmatter.context.technology} configuration: ${input.prompt}`;

      // Append verification feedback for retry loop
      if (typeof input._verificationFeedback === "string") {
        userPrompt += `\n\nThe previous output had verification issues. Fix ALL of them:\n${input._verificationFeedback}`;
      }

      // 5. Call LLM WITHOUT schema (free-text mode)
      const response = await this.provider.generate({
        system: systemPrompt,
        prompt: userPrompt,
      });

      // 6. Strip code fences from response
      const rawContent = stripCodeFences(response.content);

      return {
        success: true,
        data: { generated: rawContent, isUpdate },
        usage: response.usage,
      };
    } catch (err) {
      return failedOutput(err);
    }
  }

  /** Whether this module uses multi-file JSON output (multiple file specs + JSON format). */
  private isMultiFileOutput(): boolean {
    return (
      this.module.frontmatter.files.length > 1 &&
      this.module.frontmatter.context.fileFormat === "json"
    );
  }

  /** Write generated content to all declared file specs. */
  private writeFileSpecs(
    input: Record<string, unknown>,
    generated: string,
    isUpdate: boolean,
    basePath: string,
  ): { filesWritten: string[]; filesModified: string[]; filesUnchanged: string[] } {
    const filesWritten: string[] = [];
    const filesModified: string[] = [];
    const filesUnchanged: string[] = [];

    // Multi-file mode: parse JSON wrapper to route content per file
    let fileContents: Record<string, string> | null = null;
    if (this.isMultiFileOutput()) {
      try {
        fileContents = parseMultiFileOutput(generated);
      } catch (parseErr) {
        // If the LLM returned non-JSON content (e.g. raw YAML for an analysis task)
        // and all file specs are conditional, gracefully skip file writing.
        const allConditional = this.module.frontmatter.files.every((f) => f.conditional);
        if (allConditional && !generated.trimStart().startsWith("{")) {
          return { filesWritten: [], filesModified: [], filesUnchanged: [] };
        }
        throw parseErr;
      }
    }

    // Build normalized lookup for LLM-generated keys.
    // LLMs generate keys like "playbook.yml" or "templates/deployment.yaml"
    // while file specs use "{outputPath}/playbook.yml" or "{outputPath}/templates/deployment.yaml".
    // Normalize both sides by stripping {outputPath}/ or its resolved value.
    const outputPath = typeof input.outputPath === "string" ? input.outputPath : "";
    let normalizedContents: Record<string, string> | null = null;
    if (fileContents) {
      normalizedContents = {};
      for (const [key, val] of Object.entries(fileContents)) {
        const nKey = stripOutputPrefix(key, outputPath);
        normalizedContents[nKey] = val;
      }
    }

    // Track which LLM keys were consumed so we can write unmatched dynamic files afterwards
    const consumedLlmKeys = new Set<string>();

    for (const fileSpec of this.module.frontmatter.files) {
      const resolvedPath = resolveFilePath(fileSpec.path, input);
      let content: string;
      if (normalizedContents) {
        const normalizedSpec = stripOutputPrefix(fileSpec.path, outputPath);
        let match = normalizedContents[normalizedSpec];
        let matchedKey = normalizedSpec;
        // Basename fallback: if LLM outputs a shortened key (e.g. "action.yml" instead of
        // ".github/actions/setup-node/action.yml"), match by basename or suffix.
        // Only applies when there's exactly one LLM key matching — avoids ambiguity.
        if (match === undefined) {
          const candidates: string[] = [];
          for (const llmKey of Object.keys(normalizedContents)) {
            if (
              normalizedSpec.endsWith("/" + llmKey) ||
              normalizedSpec === llmKey ||
              path.basename(normalizedSpec) === llmKey
            ) {
              candidates.push(llmKey);
            }
          }
          if (candidates.length === 1) {
            match = normalizedContents[candidates[0]];
            matchedKey = candidates[0];
          }
        }
        if (match === undefined) {
          if (fileSpec.conditional) continue; // skip optional files not generated
          throw new Error(`Multi-file output missing required file: ${fileSpec.path}`);
        }
        consumedLlmKeys.add(matchedKey);
        content = match;
      } else {
        content = generated;
      }
      const fullPath = path.isAbsolute(resolvedPath)
        ? resolvedPath
        : path.join(basePath, resolvedPath);

      if (this.module.frontmatter.scope) {
        if (!matchesScopePattern(resolvedPath, this.module.frontmatter.scope.write, input)) {
          throw new Error(`Write to '${resolvedPath}' blocked by scope policy`);
        }
      }

      if (isUpdate && fs.existsSync(fullPath)) {
        // Skip write if content is identical — no-op update
        const existing = fs.readFileSync(fullPath, "utf-8");
        if (existing === content) {
          filesUnchanged.push(resolvedPath);
          continue;
        }
        filesModified.push(resolvedPath);
      } else {
        filesWritten.push(resolvedPath);
      }

      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
    }

    // Write dynamically-named LLM output files not matched by any declared file spec.
    // This handles cases where the LLM generates files with names determined by the prompt
    // (e.g. ".github/actions/docker-build/action.yml" not pre-declared in the .dops file).
    if (normalizedContents) {
      for (const [llmKey, content] of Object.entries(normalizedContents)) {
        if (consumedLlmKeys.has(llmKey)) continue;

        const resolvedPath =
          outputPath && outputPath !== "." ? path.join(outputPath, llmKey) : llmKey;

        // Scope check: only write if within declared scope
        if (this.module.frontmatter.scope) {
          if (!matchesScopePattern(resolvedPath, this.module.frontmatter.scope.write, input)) {
            continue; // silently skip files outside scope
          }
        }

        const fullPath = path.isAbsolute(resolvedPath)
          ? resolvedPath
          : path.join(basePath, resolvedPath);

        if (isUpdate && fs.existsSync(fullPath)) {
          const existing = fs.readFileSync(fullPath, "utf-8");
          if (existing === content) {
            filesUnchanged.push(resolvedPath);
            continue;
          }
          filesModified.push(resolvedPath);
        } else {
          filesWritten.push(resolvedPath);
        }

        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, content, "utf-8");
      }
    }

    // Guard: multi-file mode must produce at least one file action
    if (
      normalizedContents &&
      filesWritten.length === 0 &&
      filesModified.length === 0 &&
      filesUnchanged.length === 0
    ) {
      const llmKeys = Object.keys(normalizedContents).join(", ");
      throw new Error(
        `No files matched between LLM output keys [${llmKeys}] and declared file specs`,
      );
    }

    return { filesWritten, filesModified, filesUnchanged };
  }

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    // Default outputPath to module name when file specs reference {outputPath}
    const effectiveInput = this.applyOutputPathDefault(input);

    // Use pre-generated output from SafeExecutor when available (avoids redundant LLM call)
    const preGen = input._generatedOutput as ToolOutput | undefined;
    const genResult =
      preGen?.success && preGen.data !== undefined ? preGen : await this.generate(effectiveInput);
    if (!genResult.success || !genResult.data) return genResult;

    const { generated, isUpdate } = genResult.data as { generated: string; isUpdate: boolean };

    // Post-generation validation: check paths and content format before writing
    try {
      const fileFormat = this.module.frontmatter.context.fileFormat;
      if (this.isMultiFileOutput()) {
        // Multi-file: wrapper is JSON, individual files are raw content
        // Validate paths only — individual file content format varies
        const fileContents = parseMultiFileOutput(generated);
        const pathErrors = validateGeneratedPaths(Object.keys(fileContents));
        if (pathErrors.length > 0) {
          return failedOutput(new Error(`Path validation failed: ${pathErrors.join("; ")}`));
        }
        // Check non-empty content
        for (const [fp, content] of Object.entries(fileContents)) {
          if (!content || content.trim().length === 0) {
            return failedOutput(new Error(`Content validation failed: Empty content for ${fp}`));
          }
        }
      } else {
        // Single-file: validate content against declared format
        const contentErrors = validateGeneratedContent(generated, fileFormat, this.name);
        if (contentErrors.length > 0) {
          return failedOutput(new Error(`Content validation failed: ${contentErrors.join("; ")}`));
        }
      }
    } catch (validationErr) {
      // Don't block on validation errors for non-parseable formats (raw, hcl)
      // — those are caught later by binary verification
      const msg = validationErr instanceof Error ? validationErr.message : String(validationErr);
      if (msg.includes("Path validation") || msg.includes("Content validation")) {
        return failedOutput(validationErr);
      }
      // Parse failure for multi-file is handled by writeFileSpecs
    }

    try {
      const basePath = this.options.basePath ?? process.cwd();
      const { filesWritten, filesModified, filesUnchanged } = this.writeFileSpecs(
        effectiveInput,
        generated,
        isUpdate,
        basePath,
      );

      return {
        success: true,
        data: { generated, isUpdate },
        filesWritten,
        filesModified,
        filesUnchanged,
        usage: genResult.usage,
      };
    } catch (err) {
      return failedOutput(err);
    }
  }

  async verify(data: unknown): Promise<VerificationResult> {
    const verificationConfig = this.module.frontmatter.verification;
    const permissions = this.module.frontmatter.permissions ?? {};

    // For v2, data may be a raw string or a { generated, isUpdate } object from generate().
    // Extract the generated content string for verification.
    const rawContentFallback =
      data && typeof data === "object" && "generated" in data
        ? String((data as Record<string, unknown>).generated)
        : String(data);
    const rawContent = typeof data === "string" ? data : rawContentFallback;
    const fileFormat = this.module.frontmatter.context.fileFormat;
    const parsed = parseRawContent(rawContent, fileFormat);

    // Extract peer files from prior plan tasks (e.g., other .tf files for terraform validate)
    const peerFiles: Record<string, string> =
      data && typeof data === "object" && "_peerFiles" in data
        ? ((data as Record<string, unknown>)._peerFiles as Record<string, string>)
        : {};

    // Run structural validation against parsed content (if parseable)
    const structuralIssues: VerificationIssue[] =
      verificationConfig?.structural && parsed
        ? validateStructure(parsed, verificationConfig.structural)
        : [];

    // For multi-file modules, parse the JSON wrapper and pass individual files
    // so verification tools receive the actual file contents (e.g. HCL not JSON).
    let verifyFiles: Record<string, string> | undefined;
    let filename = "output";
    if (this.isMultiFileOutput()) {
      try {
        verifyFiles = parseMultiFileOutput(rawContent);
      } catch {
        // If parsing fails, fall back to single-file verification
      }
    }
    if (!verifyFiles && this.module.frontmatter.files.length > 0) {
      const primaryFile = this.module.frontmatter.files[0];
      const pathParts = primaryFile.path.split("/");
      filename = pathParts[pathParts.length - 1].replace(/\{[^}]+\}/g, "output"); // NOSONAR
    }

    // Merge peer files from prior tasks so verification tools see the full context
    // (e.g., terraform validate needs all .tf files, not just the current task's output)
    if (verifyFiles && Object.keys(peerFiles).length > 0) {
      // Peer files go first — current task's files override if names collide
      verifyFiles = { ...peerFiles, ...verifyFiles };
    } else if (!verifyFiles && Object.keys(peerFiles).length > 0) {
      verifyFiles = { ...peerFiles };
    }

    const verificationResult = await runVerification(
      parsed ?? data,
      rawContent,
      filename,
      verificationConfig,
      permissions,
      structuralIssues,
      this.name,
      verifyFiles,
      this.options?.onBinaryMissing,
    );

    // Post-generation audit: check generated content against Context7 docs
    if (this._lastDocsCache) {
      const auditResult = auditAgainstDocs(
        rawContent,
        this._lastDocsCache,
        this.module.frontmatter.context.technology,
      );
      if (auditResult.issues.length > 0) {
        verificationResult.issues.push(...auditResult.issues);
      }
    }

    return verificationResult;
  }

  get systemPromptHash(): string {
    return this._systemPromptHash;
  }

  get moduleHash(): string {
    return this._moduleHash;
  }

  get metadata(): ToolMetadata {
    return buildToolMetadata(this.module.frontmatter, this._moduleHash, this._systemPromptHash);
  }

  get risk(): DopsRisk {
    return getRisk(this.module.frontmatter);
  }

  get executionMode(): DopsExecution {
    return getExecutionMode(this.module.frontmatter);
  }

  get isDeterministic(): boolean {
    return this.executionMode.deterministic;
  }

  get isIdempotent(): boolean {
    return this.executionMode.idempotent;
  }

  get keywords(): string[] {
    return parseKeywords(this.module.sections.keywords);
  }

  get fileSpecs(): FileSpecV2[] {
    return this.module.frontmatter.files;
  }

  /**
   * If any file spec references `{outputPath}` and the input doesn't provide one,
   * default it to "." (current directory).
   */
  private applyOutputPathDefault(input: Record<string, unknown>): Record<string, unknown> {
    if (input.outputPath) return input;

    const usesOutputPath = this.module.frontmatter.files.some((f) =>
      f.path.includes("{outputPath}"),
    );
    if (!usesOutputPath) return input;

    return { ...input, outputPath: "." };
  }

  /**
   * Fetch documentation from Context7 for declared libraries.
   * Resolves each library by name, then queries docs with the user's prompt.
   */
  private async fetchContext7Docs(libraries: Context7LibraryRef[]): Promise<string> {
    const provider = this.options.context7Provider;
    if (!provider) return "";

    const docParts: string[] = [];

    for (const lib of libraries) {
      try {
        const resolved = await provider.resolveLibrary(lib.name, lib.query);
        if (!resolved) continue;

        const docs = await provider.queryDocs(resolved.id, lib.query);
        if (docs && docs.trim().length > 0) {
          docParts.push(`### ${lib.name}\n${docs}`);
        }
      } catch {
        // Graceful degradation: skip failed library lookups
      }
    }

    return docParts.join("\n\n");
  }
}
