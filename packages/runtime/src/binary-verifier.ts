import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { VerificationResult, VerificationIssue } from "@dojops/sdk";
import { BinaryVerificationConfig, VerificationConfig } from "./spec";
import { getParser, SeverityMapping } from "./parsers/index";

/**
 * Allowed verification binaries — same whitelist as custom-tool.ts in tool-registry.
 */
const ALLOWED_VERIFICATION_BINARIES = new Set([
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
  "nginx",
  "promtool",
  "systemd-analyze",
  "make",
]);

function isVerificationCommandAllowed(command: string): boolean {
  const binary = command.split(/\s+/)[0];
  return ALLOWED_VERIFICATION_BINARIES.has(binary);
}

export interface BinaryVerifierInput {
  /** The generated content to verify (to be written to tmpdir) */
  content: string;
  /** Filename to write the content as */
  filename: string;
  /** Binary verification config from .dops */
  config: BinaryVerificationConfig;
  /** Severity mapping for parsers that support it */
  severityMapping?: SeverityMapping;
  /** Whether child_process permission is required */
  childProcessPermission?: "required" | "none";
}

/**
 * Run binary verification in a temp directory.
 * Returns VerificationResult with rich parsed issues.
 */
export async function verifyWithBinary(input: BinaryVerifierInput): Promise<VerificationResult> {
  const { content, filename, config, severityMapping, childProcessPermission } = input;

  // Security gate 1: child_process permission
  if (childProcessPermission !== "required") {
    return {
      passed: true,
      tool: config.parser,
      issues: [
        { severity: "info", message: "Binary verification skipped (no child_process permission)" },
      ],
    };
  }

  // Security gate 2: command whitelist
  if (!isVerificationCommandAllowed(config.command)) {
    return {
      passed: false,
      tool: config.parser,
      issues: [
        {
          severity: "error",
          message: `Verification command not allowed: ${config.command.split(/\s+/)[0]}`,
        },
      ],
    };
  }

  // Get the parser
  const parser = getParser(config.parser);
  if (!parser) {
    return {
      passed: false,
      tool: config.parser,
      issues: [{ severity: "error", message: `Unknown verification parser: ${config.parser}` }],
    };
  }

  // Create temp directory and write content
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-verify-"));

  try {
    fs.writeFileSync(path.join(tmpDir, filename), content, "utf-8");

    // Parse command into binary + args
    const parts = config.command.split(/\s+/);
    const binary = parts[0];
    const args = parts.slice(1);

    // Execute the binary
    let rawOutput: string;
    try {
      rawOutput = execFileSync(binary, args, {
        encoding: "utf-8",
        timeout: config.timeout,
        stdio: "pipe",
        cwd: tmpDir,
      });
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          passed: true,
          tool: config.parser,
          issues: [{ severity: "warning", message: `${binary} not found — verification skipped` }],
        };
      }
      // Many tools exit non-zero on validation errors but still produce parseable output
      const execErr = err as { stdout?: string; stderr?: string };
      rawOutput = execErr.stdout || execErr.stderr || "";
      if (!rawOutput) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          passed: false,
          tool: config.parser,
          issues: [{ severity: "error", message: `Verification failed: ${msg}` }],
        };
      }
    }

    // Parse the output
    const issues: VerificationIssue[] = parser(rawOutput, severityMapping);
    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      passed: !hasErrors,
      tool: config.parser,
      issues,
      rawOutput,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Run full verification: structural rules + optional binary verification.
 */
export async function runVerification(
  data: unknown,
  serializedContent: string,
  filename: string,
  verificationConfig: VerificationConfig | undefined,
  permissions: { child_process?: "required" | "none" },
  structuralIssues: VerificationIssue[],
  toolName: string,
): Promise<VerificationResult> {
  const allIssues: VerificationIssue[] = [...structuralIssues];

  // Binary verification
  if (verificationConfig?.binary) {
    const binaryResult = await verifyWithBinary({
      content: serializedContent,
      filename,
      config: verificationConfig.binary,
      severityMapping: verificationConfig.severity as SeverityMapping | undefined,
      childProcessPermission: permissions.child_process,
    });
    allIssues.push(...binaryResult.issues);
  }

  const hasErrors = allIssues.some((i) => i.severity === "error");

  return {
    passed: !hasErrors,
    tool: toolName,
    issues: allIssues,
  };
}
