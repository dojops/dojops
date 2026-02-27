import * as crypto from "crypto";
import { LLMProvider, parseAndValidate } from "@dojops/core";
import type { DevOpsTool, ToolOutput, VerificationResult, VerificationIssue } from "@dojops/sdk";
import { ZodTypeAny } from "zod";
import { DopsExecution, DopsModule, DopsRisk, FileSpec } from "./spec";
import { compileInputSchema, compileOutputSchema } from "./schema-compiler";
import { compilePrompt, PromptContext } from "./prompt-compiler";
import { validateStructure } from "./structural-validator";
import { runVerification } from "./binary-verifier";
import { writeFiles, serializeForFile, detectExistingContent } from "./file-writer";

export interface DopsRuntimeOptions {
  /** Base path for file detection (defaults to cwd) */
  basePath?: string;
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

/**
 * DopsRuntime: The unified tool runtime engine.
 * Processes all tools — built-in .dops modules and user .dops files — through one code path.
 */
export class DopsRuntime implements DevOpsTool<Record<string, unknown>> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodTypeAny;

  private readonly module: DopsModule;
  private readonly provider: LLMProvider;
  private readonly outputSchema: ZodTypeAny;
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
    const result = this.inputSchema.safeParse(input);
    if (result.success) return { valid: true };
    return { valid: false, error: result.error.message };
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
      const systemPrompt = compilePrompt(this.module.sections, context);

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
      filename = pathParts[pathParts.length - 1].replace(/\{[^}]+\}/g, "output");
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
    return (
      this.module.frontmatter.risk ?? {
        level: "LOW",
        rationale: "No risk classification declared",
      }
    );
  }

  get executionMode(): DopsExecution {
    return (
      this.module.frontmatter.execution ?? {
        mode: "generate",
        deterministic: false,
        idempotent: false,
      }
    );
  }

  get isDeterministic(): boolean {
    return this.executionMode.deterministic;
  }

  get isIdempotent(): boolean {
    return this.executionMode.idempotent;
  }

  get keywords(): string[] {
    return this.module.sections.keywords
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
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
