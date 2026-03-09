import { runBin } from "./safe-exec";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { VerificationResult, VerificationIssue } from "@dojops/sdk";
import type { OnBinaryMissing } from "@dojops/core";
import { BinaryVerificationConfig, VerificationConfig } from "./spec";
import { getParser, SeverityMapping } from "./parsers/index";

/**
 * Allowed verification binaries — same whitelist as custom-tool.ts in tool-registry.
 */
export const ALLOWED_VERIFICATION_BINARIES = new Set([
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
  /** Whether network permission is required (default: "none") */
  networkPermission?: "required" | "none";
  /** Multiple files to write (overrides content/filename when present) */
  files?: Record<string, string>;
  /** Optional callback to auto-install a missing binary. Returns true if installed. */
  onBinaryMissing?: OnBinaryMissing;
}

/** Build a skip/error result for pre-execution checks. */
function skipResult(
  parser: string,
  severity: "info" | "error" | "warning",
  message: string,
  passed = false,
): VerificationResult {
  return { passed, tool: parser, issues: [{ severity, message }] };
}

/** Execute a single command in a chained verification pipeline. */
async function executeVerificationCommand(
  binary: string,
  args: string[],
  config: BinaryVerificationConfig,
  tmpDir: string,
  networkPermission: string | undefined,
  onBinaryMissing?: OnBinaryMissing,
): Promise<{ rawOutput: string; earlyReturn?: VerificationResult; shouldBreak?: boolean }> {
  let finalArgs = args;

  // E-8: Network safety
  if (networkPermission !== "required") {
    if (binary === "terraform" && finalArgs[0] === "init" && !finalArgs.includes("-get=false")) {
      finalArgs = [...finalArgs, "-get=false"];
    }
  }

  if (!ALLOWED_VERIFICATION_BINARIES.has(binary)) {
    return {
      rawOutput: "",
      earlyReturn: skipResult(
        config.parser,
        "error",
        `Verification command not allowed: ${binary}`,
      ),
    };
  }

  try {
    const rawOutput = runBin(binary, finalArgs, {
      encoding: "utf-8",
      timeout: config.timeout,
      stdio: "pipe",
      cwd: tmpDir,
    }) as string;
    return { rawOutput };
  } catch (err: unknown) {
    if (isENOENT(err)) {
      // Attempt auto-install if callback is provided
      if (onBinaryMissing) {
        const installed = await onBinaryMissing(binary);
        if (installed) {
          // Retry the command after successful install (no callback to prevent infinite loop)
          return executeVerificationCommand(binary, args, config, tmpDir, networkPermission);
        }
      }
      return {
        rawOutput: "",
        earlyReturn: skipResult(
          config.parser,
          "warning",
          `${binary} not found — verification skipped`,
          true,
        ),
      };
    }
    const execErr = err as { stdout?: string; stderr?: string };
    const rawOutput =
      execErr.stdout || execErr.stderr || (err instanceof Error ? err.message : String(err));
    return { rawOutput, shouldBreak: true };
  }
}

/**
 * Run binary verification in a temp directory.
 * Returns VerificationResult with rich parsed issues.
 */
export async function verifyWithBinary(input: BinaryVerifierInput): Promise<VerificationResult> {
  const { content, filename, config, severityMapping, childProcessPermission, networkPermission } =
    input;

  if (childProcessPermission !== "required") {
    return skipResult(
      config.parser,
      "info",
      "Binary verification skipped (no child_process permission)",
      true,
    );
  }
  if (!isVerificationCommandAllowed(config.command)) {
    return skipResult(
      config.parser,
      "error",
      `Verification command not allowed: ${config.command.split(/\s+/)[0]}`,
    ); // NOSONAR
  }

  const parser = getParser(config.parser);
  if (!parser) {
    return skipResult(config.parser, "error", `Unknown verification parser: ${config.parser}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-verify-"));
  try {
    if (input.files && Object.keys(input.files).length > 0) {
      for (const [fname, fcontent] of Object.entries(input.files)) {
        const filePath = path.join(tmpDir, fname);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, fcontent, "utf-8");
      }
    } else {
      fs.writeFileSync(path.join(tmpDir, filename), content, "utf-8");
    }

    // Resolve {entryFile} placeholder in the verification command.
    // This allows .dops modules to reference the actual generated filename
    // instead of hardcoding (e.g., ansible playbooks may be named dynamically).
    const resolvedCommand = resolveCommandPlaceholders(config.command, input.files, filename);

    const commands = resolvedCommand.split(/\s*&&\s*/); // NOSONAR
    let rawOutput = "";
    for (let i = 0; i < commands.length; i++) {
      const parts = commands[i].split(/\s+/).filter(Boolean);
      const result = await executeVerificationCommand(
        parts[0],
        parts.slice(1),
        config,
        tmpDir,
        networkPermission,
        input.onBinaryMissing,
      );
      if (result.earlyReturn) return result.earlyReturn;
      rawOutput = result.rawOutput;
      if (result.shouldBreak && i < commands.length - 1) break;
    }

    const issues: VerificationIssue[] = parser(rawOutput, severityMapping);
    const hasErrors = issues.some((i) => i.severity === "error");
    return { passed: !hasErrors, tool: config.parser, issues, rawOutput };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Resolve template placeholders in a verification command.
 *
 * Supported placeholders:
 * - `{entryFile}` — resolves to the main entry file from the files map.
 *   For multi-file outputs, picks the top-level .yml/.yaml file (prefers site.yml/playbook.yml).
 *   Falls back to the single-file filename.
 */
function resolveCommandPlaceholders(
  command: string,
  files: Record<string, string> | undefined,
  fallbackFilename: string,
): string {
  if (!command.includes("{entryFile}")) return command;

  let entryFile = fallbackFilename;

  if (files && Object.keys(files).length > 0) {
    const fileNames = Object.keys(files);
    // Top-level files only (no path separators)
    const topLevel = fileNames.filter((f) => !f.includes("/"));
    // Prefer well-known entry points
    const preferred = ["site.yml", "playbook.yml", "site.yaml", "playbook.yaml"];
    const match = preferred.find((p) => topLevel.includes(p));
    if (match) {
      entryFile = match;
    } else if (topLevel.length > 0) {
      // Pick the first top-level .yml/.yaml file
      const yamlFile = topLevel.find((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
      entryFile = yamlFile ?? topLevel[0];
    } else {
      // No top-level files — use the first file
      entryFile = fileNames[0];
    }
  }

  return command.replace(/\{entryFile\}/g, entryFile);
}

/**
 * Run full verification: structural rules + optional binary verification.
 */
export async function runVerification(
  data: unknown,
  serializedContent: string,
  filename: string,
  verificationConfig: VerificationConfig | undefined,
  permissions: { child_process?: "required" | "none"; network?: "required" | "none" },
  structuralIssues: VerificationIssue[],
  toolName: string,
  files?: Record<string, string>,
  onBinaryMissing?: OnBinaryMissing,
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
      networkPermission: permissions.network,
      files,
      onBinaryMissing,
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
