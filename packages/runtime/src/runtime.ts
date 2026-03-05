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

    // Compute hashes
    this._systemPromptHash = crypto
      .createHash("sha256")
      .update(module.sections.prompt)
      .digest("hex");

    this._moduleHash = crypto.createHash("sha256").update(module.raw).digest("hex");
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    return validateInput(this.inputSchema, input);
  }

  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      // 1. Detect existing content
      let existingContent: string | undefined = input.existingContent as string | undefined;
      const basePath = this.options.basePath ?? process.cwd();

      if (!existingContent && this.module.frontmatter.detection) {
        const detected = detectExistingContent(this.module.frontmatter.detection.paths, basePath);
        if (detected) {
          existingContent = detected;
        }
      }

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
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
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
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
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
    return {
      toolType: "built-in",
      toolVersion: this.module.frontmatter.meta.version,
      toolHash: this._moduleHash,
      toolSource: "dops",
      systemPromptHash: this._systemPromptHash,
      riskLevel: this.risk.level,
      icon: this.module.frontmatter.meta.icon,
    };
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
}

/**
 * Strip markdown code fences from LLM output.
 * Handles ```lang ... ``` and ~~~ ... ~~~ wrappers.
 */
export function stripCodeFences(content: string): string {
  const trimmed = content.trim();

  // Match ```<optional-lang>\n...\n``` or ~~~<optional-lang>\n...\n~~~
  const fenceMatch = /^(?:```|~~~)\w*\n([\s\S]*?)\n(?:```|~~~)$/.exec(trimmed);
  if (fenceMatch) {
    return fenceMatch[1];
  }

  return trimmed;
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

  constructor(module: DopsModuleV2, provider: LLMProvider, options?: DopsRuntimeV2Options) {
    this.module = module;
    this.provider = provider;
    this.options = options ?? {};

    this.name = module.frontmatter.meta.name;
    this.description = module.frontmatter.meta.description;

    // v2: minimal input schema — just prompt + existingContent
    this.inputSchema = z.object({
      prompt: z.string().min(1),
      existingContent: z.string().optional(),
    });

    this._systemPromptHash = crypto
      .createHash("sha256")
      .update(module.sections.prompt)
      .digest("hex");

    this._moduleHash = crypto.createHash("sha256").update(module.raw).digest("hex");
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    return validateInput(this.inputSchema, input);
  }

  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      // 1. Detect existing content
      let existingContent = input.existingContent as string | undefined;
      const basePath = this.options.basePath ?? process.cwd();

      if (!existingContent && this.module.frontmatter.detection) {
        const detected = detectExistingContent(this.module.frontmatter.detection.paths, basePath);
        if (detected) {
          existingContent = detected;
        }
      }

      // 2. Fetch Context7 docs from declared libraries
      let context7Docs = "";
      if (this.options.context7Provider && this.module.frontmatter.context.context7Libraries) {
        context7Docs = await this.fetchContext7Docs(
          this.module.frontmatter.context.context7Libraries,
        );
      }

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
      const userPrompt = isUpdate
        ? `Update the existing ${this.module.frontmatter.context.technology} configuration: ${input.prompt}`
        : `Generate ${this.module.frontmatter.context.technology} configuration: ${input.prompt}`;

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
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    // 1. Generate
    const genResult = await this.generate(input);
    if (!genResult.success || !genResult.data) return genResult;

    const { generated, isUpdate } = genResult.data as {
      generated: string;
      isUpdate: boolean;
    };

    try {
      const filesWritten: string[] = [];
      const filesModified: string[] = [];
      const basePath = this.options.basePath ?? process.cwd();

      for (const fileSpec of this.module.frontmatter.files) {
        // Resolve path template — v2 paths use simple patterns
        const resolvedPath = resolveFilePath(fileSpec.path, input);
        const fullPath = path.isAbsolute(resolvedPath)
          ? resolvedPath
          : path.join(basePath, resolvedPath);

        // Scope enforcement
        if (this.module.frontmatter.scope) {
          if (!matchesScopePattern(resolvedPath, this.module.frontmatter.scope.write, input)) {
            throw new Error(`Write to '${resolvedPath}' blocked by scope policy`);
          }
        }

        // Backup existing files on update
        if (isUpdate && fs.existsSync(fullPath)) {
          fs.copyFileSync(fullPath, fullPath + ".bak");
          filesModified.push(resolvedPath);
        } else {
          filesWritten.push(resolvedPath);
        }

        // Ensure directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write raw content directly — no serialization step
        fs.writeFileSync(fullPath, generated, "utf-8");
      }

      return {
        success: true,
        data: { generated, isUpdate },
        filesWritten,
        filesModified,
        usage: genResult.usage,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
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

    // Run structural validation against parsed content (if parseable)
    const structuralIssues: VerificationIssue[] =
      verificationConfig?.structural && parsed
        ? validateStructure(parsed, verificationConfig.structural)
        : [];

    // For binary verification, use the raw content directly
    let filename = "output";
    if (this.module.frontmatter.files.length > 0) {
      const primaryFile = this.module.frontmatter.files[0];
      const pathParts = primaryFile.path.split("/");
      filename = pathParts[pathParts.length - 1].replace(/\{[^}]+\}/g, "output"); // NOSONAR
    }

    return runVerification(
      parsed ?? data,
      rawContent,
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
    return {
      toolType: "built-in",
      toolVersion: this.module.frontmatter.meta.version,
      toolHash: this._moduleHash,
      toolSource: "dops",
      systemPromptHash: this._systemPromptHash,
      riskLevel: this.risk.level,
      icon: this.module.frontmatter.meta.icon,
    };
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
