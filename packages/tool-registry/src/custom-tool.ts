import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { ZodTypeAny } from "zod";
import {
  DevOpsTool,
  ToolOutput,
  VerificationResult,
  VerificationIssue,
  readExistingConfig,
  backupFile,
  atomicWriteFileSync,
} from "@dojops/sdk";
import { LLMProvider, sanitizeSystemPrompt } from "@dojops/core";
import { ToolManifest, ToolSource } from "./types";
import { jsonSchemaToZod, JSONSchemaObject } from "./json-schema-to-zod";
import { serialize } from "./serializers";

export const ALLOWED_VERIFICATION_BINARIES = [
  "terraform",
  "kubectl",
  "helm",
  "ansible-lint",
  "docker",
  "hadolint",
  "yamllint",
  "jsonlint",
  "shellcheck",
  "tflint",
  "kubeval",
  "conftest",
  "checkov",
  "trivy",
  "kube-score",
  "polaris",
] as const;

export function isVerificationCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  return ALLOWED_VERIFICATION_BINARIES.some(
    (bin) => trimmed === bin || trimmed.startsWith(`${bin} `) || trimmed.startsWith(`${bin}\t`),
  );
}

/**
 * Adapts a declarative ToolManifest into a DevOpsTool-compatible object.
 * This is the core bridge that makes custom tools behave identically to built-in tools.
 */
export class CustomTool implements DevOpsTool<Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  source: ToolSource;

  private manifest: ToolManifest;
  private provider: LLMProvider;
  private toolDir: string;
  private outputZodSchema?: ZodTypeAny;

  constructor(
    manifest: ToolManifest,
    provider: LLMProvider,
    toolDir: string,
    source: ToolSource,
    inputSchemaRaw: Record<string, unknown>,
    outputSchemaRaw?: Record<string, unknown>,
  ) {
    this.manifest = manifest;
    this.provider = provider;
    this.toolDir = toolDir;
    this.source = source;
    this.name = manifest.name;
    this.description = manifest.description;
    this.inputSchema = jsonSchemaToZod(inputSchemaRaw as JSONSchemaObject);

    if (outputSchemaRaw) {
      this.outputZodSchema = jsonSchemaToZod(outputSchemaRaw as JSONSchemaObject);
    }
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    const result = this.inputSchema.safeParse(input);
    if (result.success) {
      return { valid: true };
    }
    return { valid: false, error: result.error.message };
  }

  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      let existingContent: string | undefined;

      // If updateMode is enabled and detector path exists, read existing content
      if (this.manifest.generator.updateMode && this.manifest.detector?.path) {
        const rawPath = this.manifest.detector.path;
        const paths = Array.isArray(rawPath) ? rawPath : [rawPath];
        for (const p of paths) {
          const detectorPath = this.resolveFilePath(p, input);
          const content = readExistingConfig(detectorPath);
          if (content) {
            existingContent = content;
            break;
          }
        }
      }

      // Also check if existingContent was provided in input
      if (input.existingContent && typeof input.existingContent === "string") {
        existingContent = input.existingContent;
      }

      const isUpdate = !!existingContent;

      // Build the LLM prompt
      let systemPrompt = this.manifest.generator.systemPrompt;
      if (isUpdate && existingContent) {
        systemPrompt = sanitizeSystemPrompt(systemPrompt, existingContent);
      }

      const userPrompt = this.buildUserPrompt(input);

      const response = await this.provider.generate({
        system: systemPrompt,
        prompt: userPrompt,
        schema: this.outputZodSchema,
      });

      let data: unknown;
      if (response.parsed) {
        data = response.parsed;
      } else {
        try {
          data = JSON.parse(response.content);
        } catch {
          data = response.content;
        }
      }

      return {
        success: true,
        data: { generated: data, isUpdate },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    const result = await this.generate(input);
    if (!result.success || !result.data) return result;

    const data = result.data as { generated: unknown; isUpdate: boolean };

    try {
      const filesWritten: string[] = [];
      const filesModified: string[] = [];

      for (const file of this.manifest.files) {
        const filePath = this.resolveFilePath(file.path, input);

        if (data.isUpdate) {
          backupFile(filePath);
          filesModified.push(filePath);
        } else {
          filesWritten.push(filePath);
        }

        const content = serialize(data.generated, file.serializer);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        atomicWriteFileSync(filePath, content);
      }

      return { ...result, filesWritten, filesModified };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  get systemPromptHash(): string {
    return crypto.createHash("sha256").update(this.manifest.generator.systemPrompt).digest("hex");
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verify(data: unknown): Promise<VerificationResult> {
    const command = this.manifest.verification?.command;

    // No command → pass (no-op)
    if (!command) {
      return { passed: true, tool: this.name, issues: [] };
    }

    // child_process permission not "required" → pass, never execute
    if (this.manifest.permissions?.child_process !== "required") {
      return { passed: true, tool: this.name, issues: [] };
    }

    // Command not in whitelist → fail
    if (!isVerificationCommandAllowed(command)) {
      const issues: VerificationIssue[] = [
        {
          severity: "error",
          message: `Verification command "${command}" is not in the allowed binaries whitelist. Allowed: ${ALLOWED_VERIFICATION_BINARIES.join(", ")}`,
        },
      ];
      return { passed: false, tool: this.name, issues };
    }

    // Whitelisted + permission required → execute
    try {
      const parts = command.split(/\s+/);
      execFileSync(parts[0], parts.slice(1), {
        cwd: this.toolDir,
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });

      return { passed: true, tool: this.name, issues: [] };
    } catch (err) {
      const output =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : String(err);

      const issues: VerificationIssue[] = [
        {
          severity: "error",
          message: `Verification command failed: ${output.slice(0, 500)}`,
        },
      ];

      return {
        passed: false,
        tool: this.name,
        issues,
        rawOutput: output,
      };
    }
  }

  private buildUserPrompt(input: Record<string, unknown>): string {
    const template = this.manifest.generator.userPromptTemplate;
    if (template) {
      let result = template;
      for (const [key, value] of Object.entries(input)) {
        if (key === "existingContent") continue;
        const replacement = typeof value === "string" ? value : JSON.stringify(value);
        result = result.replaceAll(`{${key}}`, replacement);
      }
      return result;
    }

    const parts: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "existingContent") continue;
      parts.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
    return parts.join("\n");
  }

  private resolveFilePath(templatePath: string, input: Record<string, unknown>): string {
    let resolved = templatePath;
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string") {
        resolved = resolved.replaceAll(`{${key}}`, value);
      }
    }

    // Check for unresolved template variables
    const unresolvedMatch = resolved.match(/\{[^}]+\}/);
    if (unresolvedMatch) {
      throw new Error(
        `Unresolved template variable ${unresolvedMatch[0]} in file path "${templatePath}"`,
      );
    }

    // Reject absolute paths produced by template substitution
    if (path.isAbsolute(resolved)) {
      throw new Error(`Template substitution produced an absolute path "${resolved}"`);
    }

    // Validate no path traversal in resolved path
    if (resolved.split(/[/\\]/).includes("..")) {
      throw new Error(`Path traversal detected in resolved file path "${resolved}"`);
    }

    // Anchor resolved path to toolDir to prevent escape
    const anchored = path.join(this.toolDir, resolved);
    const realBase = path.resolve(this.toolDir);
    if (
      path.resolve(anchored) !== realBase &&
      !path.resolve(anchored).startsWith(realBase + path.sep)
    ) {
      throw new Error(`Resolved path escapes tool directory`);
    }

    return anchored;
  }
}

// Backward compatibility alias
/** @deprecated Use CustomTool instead */
export const PluginTool = CustomTool;
/** @deprecated Use CustomTool instead */
export type PluginTool = CustomTool;
