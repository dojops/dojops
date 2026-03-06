import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import {
  DevOpsTool,
  ToolOutput,
  VerificationResult,
  VerificationIssue,
  readExistingConfig,
  backupFile,
  atomicWriteFileSync,
} from "@dojops/sdk";
import { LLMProvider, sanitizeSystemPrompt, sanitizeUserInput } from "@dojops/core";
import { ToolManifest, ToolSource } from "./types";
import { jsonSchemaToZod, JSONSchemaObject } from "./json-schema-to-zod";
import { serialize } from "./serializers";
import { validateSystemPrompt } from "./prompt-validator";

function failedOutput(err: unknown): ToolOutput {
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

export const ALLOWED_VERIFICATION_BINARIES = [
  "terraform",
  "kubectl",
  "helm",
  "ansible-lint",
  "ansible-playbook",
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
  "nginx",
  "promtool",
  "systemd-analyze",
  "make",
  "actionlint",
  "caddy",
  "haproxy",
  "nomad",
  "podman",
  "fluentd",
  "opa",
  "vault",
  "circleci",
  "npx",
  "tsc",
  "cfn-lint",
] as const;

export function isVerificationCommandAllowed(command: string): boolean {
  const trimmed = command.trim();
  return ALLOWED_VERIFICATION_BINARIES.some(
    (bin) => trimmed === bin || trimmed.startsWith(`${bin} `) || trimmed.startsWith(`${bin}\t`),
  );
}

const DANGEROUS_ARG_PATTERNS = [
  /--backend-config/,
  /--plugin-dir/,
  /-chdir/,
  /--config/,
  /--kubeconfig/,
  /--credentials/,
  /--token/,
  /--cert/,
  /--key/,
  /--output/,
  /--exec/,
];

/** Return the first dangerous argument found, or null if all are safe. */
function findDangerousArg(args: string[]): string | null {
  for (const arg of args) {
    if (
      DANGEROUS_ARG_PATTERNS.some((p) => p.test(arg)) ||
      arg.includes("/") ||
      arg.includes("\\")
    ) {
      return arg;
    }
  }
  return null;
}

/**
 * Adapts a declarative ToolManifest into a DevOpsTool-compatible object.
 * This is the core bridge that makes custom tools behave identically to built-in tools.
 */
export class CustomTool implements DevOpsTool<Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  source: ToolSource;

  private readonly manifest: ToolManifest;
  private readonly provider: LLMProvider;
  private readonly toolDir: string;
  private readonly projectDir: string;
  private readonly outputZodSchema?: z.ZodType;

  constructor(
    manifest: ToolManifest,
    provider: LLMProvider,
    toolDir: string,
    source: ToolSource,
    inputSchemaRaw: Record<string, unknown>,
    outputSchemaRaw?: Record<string, unknown>,
    projectDir?: string,
  ) {
    this.manifest = manifest;
    this.provider = provider;
    this.toolDir = toolDir;
    this.projectDir = projectDir ?? process.cwd();
    this.source = source;
    this.name = manifest.name;
    this.description = manifest.description;
    this.inputSchema = jsonSchemaToZod(inputSchemaRaw as JSONSchemaObject);

    if (outputSchemaRaw) {
      this.outputZodSchema = jsonSchemaToZod(outputSchemaRaw as JSONSchemaObject);
    }

    // Validate system prompt for injection patterns (A3)
    const promptValidation = validateSystemPrompt(manifest.generator.systemPrompt);
    if (!promptValidation.safe) {
      for (const warning of promptValidation.warnings) {
        console.warn(`[custom-tool] Tool "${manifest.name}": ${warning}`);
      }
    }
  }

  validate(input: unknown): { valid: boolean; error?: string } {
    const result = this.inputSchema.safeParse(input);
    if (result.success) {
      return { valid: true };
    }
    return { valid: false, error: result.error.message };
  }

  /** Detect existing config content from detector paths or input. */
  private detectExisting(input: Record<string, unknown>): string | undefined {
    if (this.manifest.generator.updateMode && this.manifest.detector?.path) {
      const rawPath = this.manifest.detector.path;
      const paths = Array.isArray(rawPath) ? rawPath : [rawPath];
      for (const p of paths) {
        const content = readExistingConfig(this.resolveDetectorPath(p, input));
        if (content) return content;
      }
    }
    if (typeof input.existingContent === "string") return input.existingContent;
    return undefined;
  }

  /** Parse LLM response data, preferring structured output. */
  private static parseResponseData(response: { parsed?: unknown; content: string }): unknown {
    if (response.parsed) return response.parsed;
    try {
      return JSON.parse(response.content);
    } catch {
      return response.content;
    }
  }

  async generate(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      const existingContent = this.detectExisting(input);
      const isUpdate = !!existingContent;

      let systemPrompt = this.manifest.generator.systemPrompt;
      if (isUpdate && existingContent) {
        systemPrompt = sanitizeSystemPrompt(systemPrompt, existingContent);
      }

      const response = await this.provider.generate({
        system: systemPrompt,
        prompt: this.buildUserPrompt(input),
        schema: this.outputZodSchema,
      });

      return {
        success: true,
        data: { generated: CustomTool.parseResponseData(response), isUpdate },
      };
    } catch (err) {
      return failedOutput(err);
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
        const filePath = this.resolveOutputPath(file.path, input);

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
      return failedOutput(err);
    }
  }

  get systemPromptHash(): string {
    return crypto.createHash("sha256").update(this.manifest.generator.systemPrompt).digest("hex");
  }

  private makeResult(
    passed: boolean,
    issues: VerificationIssue[],
    rawOutput?: string,
  ): VerificationResult {
    return { passed, tool: this.name, issues, ...(rawOutput ? { rawOutput } : {}) };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async verify(data: unknown): Promise<VerificationResult> {
    const command = this.manifest.verification?.command;

    if (!command) return this.makeResult(true, []);
    if (this.manifest.permissions?.child_process !== "required") return this.makeResult(true, []);

    if (!isVerificationCommandAllowed(command)) {
      return this.makeResult(false, [
        {
          severity: "error",
          message: `Verification command "${command}" is not in the allowed binaries whitelist. Allowed: ${ALLOWED_VERIFICATION_BINARIES.join(", ")}`,
        },
      ]);
    }

    const parts = command.split(/\s+/);
    const dangerousArg = findDangerousArg(parts.slice(1));
    if (dangerousArg) {
      return this.makeResult(false, [
        { severity: "error", message: `Dangerous argument rejected: ${dangerousArg}` },
      ]);
    }

    try {
      execFileSync(parts[0], parts.slice(1), {
        cwd: this.toolDir,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: "pipe",
      });
      return this.makeResult(true, []);
    } catch (err) {
      const output =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : String(err);
      return this.makeResult(
        false,
        [
          {
            severity: "error",
            message: `Verification command failed: ${output.slice(0, 500)}`,
          },
        ],
        output,
      );
    }
  }

  private buildUserPrompt(input: Record<string, unknown>): string {
    const template = this.manifest.generator.userPromptTemplate;
    if (template) {
      let result = template;
      for (const [key, value] of Object.entries(input)) {
        if (key === "existingContent") continue;
        const raw = typeof value === "string" ? value : JSON.stringify(value);
        // Sanitize user input to prevent prompt injection via Unicode direction overrides
        const replacement = sanitizeUserInput(raw);
        result = result.replaceAll(`{${key}}`, replacement);
      }
      return result;
    }

    const parts: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      if (key === "existingContent") continue;
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      parts.push(`${key}: ${sanitizeUserInput(raw)}`);
    }
    return parts.join("\n");
  }

  /** Resolve and anchor to toolDir — used for detector paths. */
  private resolveDetectorPath(templatePath: string, input: Record<string, unknown>): string {
    return this.resolvePathAnchored(templatePath, input, this.toolDir);
  }

  /** Resolve and anchor to projectDir — used for output file writes. */
  private resolveOutputPath(templatePath: string, input: Record<string, unknown>): string {
    return this.resolvePathAnchored(templatePath, input, this.projectDir);
  }

  private resolvePathAnchored(
    templatePath: string,
    input: Record<string, unknown>,
    baseDir: string,
  ): string {
    let resolved = templatePath;
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "string") {
        resolved = resolved.replaceAll(`{${key}}`, value);
      }
    }

    // Check for unresolved template variables
    const unresolvedMatch = /\{[^}]+\}/.exec(resolved); // NOSONAR - safe: negated character class prevents backtracking
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

    // Anchor resolved path to baseDir to prevent escape
    const anchored = path.join(baseDir, resolved);
    const realBase = path.resolve(baseDir);
    if (
      path.resolve(anchored) !== realBase &&
      !path.resolve(anchored).startsWith(realBase + path.sep)
    ) {
      throw new Error(`Resolved path escapes base directory`);
    }

    return anchored;
  }
}

// Backward compatibility alias
/** @deprecated Use CustomTool instead */
export const PluginTool = CustomTool;
/** @deprecated Use CustomTool instead */
export type PluginTool = CustomTool;
