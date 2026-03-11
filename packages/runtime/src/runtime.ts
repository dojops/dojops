import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { LLMProvider } from "@dojops/core";
import type { DevOpsTool, ToolOutput, VerificationResult, VerificationIssue } from "@dojops/sdk";
import { z } from "zod";
import { DopsExecution, DopsModule, DopsRisk, FileSpecV2, Context7LibraryRef } from "./spec";
import { compilePromptV2, PromptContextV2 } from "./prompt-compiler";
import { validateStructure } from "./structural-validator";
import { runVerification } from "./binary-verifier";
import { detectExistingContent, resolveFilePath, matchesScopePattern } from "./file-writer";
import { auditAgainstDocs } from "./context7-doc-auditor";

/** Compute SHA-256 hex hash of a string. */
function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Compute hashes for a DopsModule. */
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

interface DopsRuntimeOptionsBase {
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

// ── Shared helpers for DopsRuntimeV2 ──

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

export interface DopsRuntimeV2Options extends DopsRuntimeOptionsBase {
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
/** Map of control character codes to their JSON escape sequences. */
const CONTROL_CHAR_ESCAPES: Record<number, string> = {
  0x08: String.raw`\b`,
  0x09: String.raw`\t`,
  0x0a: String.raw`\n`,
  0x0c: String.raw`\f`,
  0x0d: String.raw`\r`,
};

/** Escape a single raw control character (U+0000–U+001F) as a JSON escape sequence. */
function escapeControlChar(code: number): string {
  return CONTROL_CHAR_ESCAPES[code] ?? String.raw`\u` + code.toString(16).padStart(4, "0");
}

/**
 * Process a single character inside a JSON string value.
 * Returns the escaped output and the number of extra characters consumed (for escape pairs).
 */
function processStringChar(
  json: string,
  i: number,
  out: string[],
): { endString: boolean; advance: number } {
  const ch = json[i];

  // Escaped pair — copy both characters verbatim
  if (ch === "\\") {
    out.push(ch);
    if (i + 1 < json.length) out.push(json[i + 1]);
    return { endString: false, advance: 1 };
  }

  // End of string
  if (ch === '"') {
    out.push(ch);
    return { endString: true, advance: 0 };
  }

  // Raw control character — escape it
  const code = ch.charCodeAt(0);
  if (code < 0x20) {
    out.push(escapeControlChar(code));
    return { endString: false, advance: 0 };
  }

  out.push(ch);
  return { endString: false, advance: 0 };
}

/**
 * Escape raw control characters (U+0000–U+001F) inside JSON string values.
 * Uses a state machine to distinguish string interiors from structural JSON.
 */
function escapeControlCharsInStrings(json: string): string {
  const out: string[] = [];
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    if (inString) {
      const result = processStringChar(json, i, out);
      i += result.advance;
      if (result.endString) inString = false;
    } else {
      if (json[i] === '"') inString = true;
      out.push(json[i]);
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
  let repaired = raw.replaceAll(/\\\n\s*/g, "");
  // 2. Remove invalid escape sequences (backslash NOT followed by valid escape char)
  repaired = repaired.replaceAll(/\\(?!["\\/bfnrtu])/g, "");
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
      yaml.loadAll(content);
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

// ── Helpers for writeFileSpecs decomposition ──

/** Tracks files written, modified, or unchanged during a write operation. */
interface FileWriteTracker {
  filesWritten: string[];
  filesModified: string[];
  filesUnchanged: string[];
}

/**
 * Match a normalized file spec path against normalized LLM output keys.
 * Uses exact match first, then basename/suffix fallback (only if unambiguous).
 */
function matchNormalizedKey(
  normalizedSpec: string,
  normalizedContents: Record<string, string>,
): { key: string; content: string } | null {
  // Direct match
  const direct = normalizedContents[normalizedSpec];
  if (direct !== undefined) {
    return { key: normalizedSpec, content: direct };
  }

  // Basename/suffix fallback — only if exactly one candidate matches
  const candidates = findBasenameCandidates(normalizedSpec, Object.keys(normalizedContents));
  if (candidates.length === 1) {
    return { key: candidates[0], content: normalizedContents[candidates[0]] };
  }

  return null;
}

/**
 * Find LLM keys that match a file spec by basename or suffix.
 * E.g., spec ".github/actions/setup-node/action.yml" matches LLM key "action.yml".
 */
function findBasenameCandidates(normalizedSpec: string, llmKeys: string[]): string[] {
  const candidates: string[] = [];
  for (const llmKey of llmKeys) {
    const isBasenameMatch = path.basename(normalizedSpec) === llmKey;
    const isSuffixMatch = normalizedSpec.endsWith("/" + llmKey);
    if (isBasenameMatch || isSuffixMatch) {
      candidates.push(llmKey);
    }
  }
  return candidates;
}

/** Resolve a dynamic file path by prepending outputPath if present. */
function resolveDynamicFilePath(outputPath: string, llmKey: string): string {
  const hasOutputPath = outputPath && outputPath !== ".";
  return hasOutputPath ? path.join(outputPath, llmKey) : llmKey;
}

/**
 * Classify a file as written/modified/unchanged and write it to disk.
 * Handles directory creation and identical-content detection.
 */
function classifyAndWriteFile(
  resolvedPath: string,
  content: string,
  isUpdate: boolean,
  basePath: string,
  tracker: FileWriteTracker,
): void {
  const fullPath = path.isAbsolute(resolvedPath) ? resolvedPath : path.join(basePath, resolvedPath);

  const isExistingFile = isUpdate && fs.existsSync(fullPath);
  if (isExistingFile) {
    const existing = fs.readFileSync(fullPath, "utf-8");
    if (existing === content) {
      tracker.filesUnchanged.push(resolvedPath);
      return;
    }
    tracker.filesModified.push(resolvedPath);
  } else {
    tracker.filesWritten.push(resolvedPath);
  }

  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

// ── Helpers for verify decomposition ──

/**
 * Extract raw content string from verify data.
 * Data may be a raw string, or a { generated, isUpdate } object from generate().
 */
function extractRawContent(data: unknown): string {
  if (typeof data === "string") return data;

  const isDataObject = data && typeof data === "object" && "generated" in data;
  if (isDataObject) {
    return String((data as Record<string, unknown>).generated);
  }

  return String(data);
}

/** Extract peer files from verify data (used by planner for multi-task verification). */
function extractPeerFiles(data: unknown): Record<string, string> {
  const hasData = data && typeof data === "object" && "_peerFiles" in data;
  if (!hasData) return {};
  return (data as Record<string, unknown>)._peerFiles as Record<string, string>;
}

/** Derive a verification filename from the primary file spec. */
function derivePrimaryFilename(fileSpecs: FileSpecV2[]): string {
  if (fileSpecs.length === 0) return "output";

  const primaryFile = fileSpecs[0];
  const pathParts = primaryFile.path.split("/");
  return pathParts[pathParts.length - 1].replace(/\{[^}]+\}/g, "output"); // NOSONAR
}

/**
 * Merge peer files with verify files.
 * Peer files go first — current task's files override if names collide.
 */
function mergePeerFiles(
  verifyFiles: Record<string, string> | undefined,
  peerFiles: Record<string, string>,
): Record<string, string> | undefined {
  const hasPeerFiles = Object.keys(peerFiles).length > 0;
  if (!hasPeerFiles) return verifyFiles;

  if (verifyFiles) {
    return { ...peerFiles, ...verifyFiles };
  }
  return { ...peerFiles };
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

  private readonly module: DopsModule;
  private readonly provider: LLMProvider;
  private readonly options: DopsRuntimeV2Options;
  private readonly _systemPromptHash: string;
  private readonly _moduleHash: string;
  /** Cache of Context7 docs fetched during generate(), reused by verify(). */
  private _lastDocsCache: string = "";

  constructor(module: DopsModule, provider: LLMProvider, options?: DopsRuntimeV2Options) {
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
    const tracker: FileWriteTracker = {
      filesWritten: [],
      filesModified: [],
      filesUnchanged: [],
    };

    const normalizedContents = this.parseAndNormalizeMultiFileOutput(generated, input);

    // Multi-file mode expected JSON but parse was gracefully skipped (all-conditional + non-JSON)
    if (this.isMultiFileOutput() && !normalizedContents) return tracker;

    const consumedLlmKeys = new Set<string>();
    const outputPath = typeof input.outputPath === "string" ? input.outputPath : "";

    this.writeDeclaredFileSpecs(
      input,
      generated,
      isUpdate,
      basePath,
      outputPath,
      normalizedContents,
      consumedLlmKeys,
      tracker,
    );

    this.writeDynamicFiles(
      input,
      isUpdate,
      basePath,
      outputPath,
      normalizedContents,
      consumedLlmKeys,
      tracker,
    );

    this.guardMultiFileMustProduceOutput(normalizedContents, tracker);

    return tracker;
  }

  /**
   * Parse multi-file output and normalize keys by stripping outputPath prefix.
   * Returns null for single-file modules.
   */
  private parseAndNormalizeMultiFileOutput(
    generated: string,
    input: Record<string, unknown>,
  ): Record<string, string> | null {
    if (!this.isMultiFileOutput()) return null;

    const fileContents = this.tryParseMultiFileOutput(generated);
    if (!fileContents) return null;

    const outputPath = typeof input.outputPath === "string" ? input.outputPath : "";
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(fileContents)) {
      normalized[stripOutputPrefix(key, outputPath)] = val;
    }
    return normalized;
  }

  /**
   * Attempt to parse multi-file JSON output. Returns null if the content is
   * clearly non-JSON (e.g. plain text analysis from an LLM task).
   */
  private tryParseMultiFileOutput(generated: string): Record<string, string> | null {
    try {
      return parseMultiFileOutput(generated);
    } catch (parseErr) {
      // If the output clearly isn't JSON (doesn't start with '{'), treat as
      // analysis/text output — return null so the caller skips file writing.
      // This handles planner tasks like "analyze the current Dockerfile" where
      // the LLM returns prose instead of file content.
      if (!generated.trimStart().startsWith("{")) {
        return null;
      }
      throw parseErr;
    }
  }

  /** Process all declared file specs and write their content. */
  private writeDeclaredFileSpecs(
    input: Record<string, unknown>,
    generated: string,
    isUpdate: boolean,
    basePath: string,
    outputPath: string,
    normalizedContents: Record<string, string> | null,
    consumedLlmKeys: Set<string>,
    tracker: FileWriteTracker,
  ): void {
    for (const fileSpec of this.module.frontmatter.files) {
      const resolvedPath = resolveFilePath(fileSpec.path, input);
      const content = this.resolveFileSpecContent(
        fileSpec,
        generated,
        outputPath,
        normalizedContents,
        consumedLlmKeys,
      );
      if (content === null) continue; // conditional file not generated

      this.enforceScopePolicy(resolvedPath, input);
      classifyAndWriteFile(resolvedPath, content, isUpdate, basePath, tracker);
    }
  }

  /**
   * Resolve the content for a single file spec. For multi-file modules, looks up
   * the matching key in normalizedContents. For single-file, returns the raw generated string.
   * Returns null if the file spec is conditional and no matching content was found.
   */
  private resolveFileSpecContent(
    fileSpec: FileSpecV2,
    generated: string,
    outputPath: string,
    normalizedContents: Record<string, string> | null,
    consumedLlmKeys: Set<string>,
  ): string | null {
    if (!normalizedContents) return generated;

    const normalizedSpec = stripOutputPrefix(fileSpec.path, outputPath);
    const matched = matchNormalizedKey(normalizedSpec, normalizedContents);

    if (!matched) {
      if (fileSpec.conditional) return null;
      throw new Error(`Multi-file output missing required file: ${fileSpec.path}`);
    }

    consumedLlmKeys.add(matched.key);
    return matched.content;
  }

  /** Throw if the resolved path violates the module's scope policy. */
  private enforceScopePolicy(resolvedPath: string, input: Record<string, unknown>): void {
    if (!this.module.frontmatter.scope) return;

    if (!matchesScopePattern(resolvedPath, this.module.frontmatter.scope.write, input)) {
      throw new Error(`Write to '${resolvedPath}' blocked by scope policy`);
    }
  }

  /**
   * Write LLM output files that didn't match any declared file spec.
   * Handles dynamically-named files whose paths are determined by the prompt.
   */
  private writeDynamicFiles(
    input: Record<string, unknown>,
    isUpdate: boolean,
    basePath: string,
    outputPath: string,
    normalizedContents: Record<string, string> | null,
    consumedLlmKeys: Set<string>,
    tracker: FileWriteTracker,
  ): void {
    if (!normalizedContents) return;

    for (const [llmKey, content] of Object.entries(normalizedContents)) {
      if (consumedLlmKeys.has(llmKey)) continue;

      const resolvedPath = resolveDynamicFilePath(outputPath, llmKey);
      const isOutsideScope = this.isOutsideScope(resolvedPath, input);
      if (isOutsideScope) continue;

      classifyAndWriteFile(resolvedPath, content, isUpdate, basePath, tracker);
    }
  }

  /** Check if a path falls outside the module's declared write scope. */
  private isOutsideScope(resolvedPath: string, input: Record<string, unknown>): boolean {
    if (!this.module.frontmatter.scope) return false;
    return !matchesScopePattern(resolvedPath, this.module.frontmatter.scope.write, input);
  }

  /** Guard: multi-file mode must produce at least one file action. */
  private guardMultiFileMustProduceOutput(
    normalizedContents: Record<string, string> | null,
    tracker: FileWriteTracker,
  ): void {
    if (!normalizedContents) return;

    const hasOutput =
      tracker.filesWritten.length > 0 ||
      tracker.filesModified.length > 0 ||
      tracker.filesUnchanged.length > 0;
    if (hasOutput) return;

    const llmKeys = Object.keys(normalizedContents).join(", ");
    throw new Error(
      `No files matched between LLM output keys [${llmKeys}] and declared file specs`,
    );
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
    const validationError = this.validateGeneratedOutput(generated);
    if (validationError) return validationError;

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

  /**
   * Validate generated output before writing files.
   * Returns a ToolOutput error if validation fails, or null if validation passes.
   */
  private validateGeneratedOutput(generated: string): ToolOutput | null {
    try {
      if (this.isMultiFileOutput()) {
        return this.validateMultiFileOutput(generated);
      }
      return this.validateSingleFileOutput(generated);
    } catch (validationErr) {
      return this.handleValidationError(validationErr);
    }
  }

  /** Validate multi-file JSON output: check paths and non-empty content. */
  private validateMultiFileOutput(generated: string): ToolOutput | null {
    const fileContents = parseMultiFileOutput(generated);

    const pathErrors = validateGeneratedPaths(Object.keys(fileContents));
    if (pathErrors.length > 0) {
      return failedOutput(new Error(`Path validation failed: ${pathErrors.join("; ")}`));
    }

    for (const [fp, content] of Object.entries(fileContents)) {
      const isEmpty = !content || content.trim().length === 0;
      if (isEmpty) {
        return failedOutput(new Error(`Content validation failed: Empty content for ${fp}`));
      }
    }

    return null;
  }

  /** Validate single-file output against declared format. */
  private validateSingleFileOutput(generated: string): ToolOutput | null {
    const fileFormat = this.module.frontmatter.context.fileFormat;
    const contentErrors = validateGeneratedContent(generated, fileFormat, this.name);
    if (contentErrors.length > 0) {
      return failedOutput(new Error(`Content validation failed: ${contentErrors.join("; ")}`));
    }
    return null;
  }

  /**
   * Handle validation errors: propagate path/content validation failures,
   * silently ignore parse failures (handled later by writeFileSpecs).
   */
  private handleValidationError(validationErr: unknown): ToolOutput | null {
    const msg = validationErr instanceof Error ? validationErr.message : String(validationErr);
    const isValidationFailure =
      msg.includes("Path validation") || msg.includes("Content validation");
    if (isValidationFailure) {
      return failedOutput(validationErr);
    }
    // Parse failure for multi-file is handled by writeFileSpecs
    return null;
  }

  async verify(data: unknown): Promise<VerificationResult> {
    const verificationConfig = this.module.frontmatter.verification;
    const permissions = this.module.frontmatter.permissions ?? {};

    const rawContent = extractRawContent(data);
    const fileFormat = this.module.frontmatter.context.fileFormat;
    const parsed = parseRawContent(rawContent, fileFormat);
    const peerFiles = extractPeerFiles(data);

    const structuralIssues: VerificationIssue[] =
      verificationConfig?.structural && parsed
        ? validateStructure(parsed, verificationConfig.structural)
        : [];

    const { verifyFiles, filename } = this.resolveVerifyFilesAndFilename(rawContent, peerFiles);

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

    this.appendDocAuditIssues(rawContent, verificationResult);

    return verificationResult;
  }

  /**
   * Resolve verification files and filename for binary verification.
   * For multi-file modules, parses the JSON wrapper. For single-file, derives filename
   * from the primary file spec.
   */
  private resolveVerifyFilesAndFilename(
    rawContent: string,
    peerFiles: Record<string, string>,
  ): { verifyFiles: Record<string, string> | undefined; filename: string } {
    let verifyFiles = this.tryParseVerifyFiles(rawContent);
    const filename = verifyFiles ? "output" : derivePrimaryFilename(this.module.frontmatter.files);
    verifyFiles = mergePeerFiles(verifyFiles, peerFiles);
    return { verifyFiles, filename };
  }

  /** Attempt to parse multi-file output for verification. Returns undefined on failure. */
  private tryParseVerifyFiles(rawContent: string): Record<string, string> | undefined {
    if (!this.isMultiFileOutput()) return undefined;
    try {
      return parseMultiFileOutput(rawContent);
    } catch {
      return undefined;
    }
  }

  /** Append Context7 doc audit issues to verification result if docs are cached. */
  private appendDocAuditIssues(rawContent: string, verificationResult: VerificationResult): void {
    if (!this._lastDocsCache) return;

    const auditResult = auditAgainstDocs(
      rawContent,
      this._lastDocsCache,
      this.module.frontmatter.context.technology,
    );
    if (auditResult.issues.length > 0) {
      verificationResult.issues.push(...auditResult.issues);
    }
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
