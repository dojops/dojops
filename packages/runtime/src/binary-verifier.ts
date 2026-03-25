import { runBin } from "@dojops/sdk";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { VerificationResult, VerificationIssue } from "@dojops/sdk";
import type { OnBinaryMissing } from "@dojops/core";
import { BinaryVerificationConfig, VerificationConfig } from "./spec";
import { getParser, SeverityMapping } from "./parsers/index";

/**
 * Allowed verification binaries for .dops skill binary verification.
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
  "packer",
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

/** Apply network safety restrictions to terraform init args. */
function applyNetworkSafety(
  binary: string,
  args: string[],
  networkPermission: string | undefined,
): string[] {
  const needsTerraformRestriction =
    networkPermission !== "required" &&
    binary === "terraform" &&
    args[0] === "init" &&
    !args.includes("-get=false");

  return needsTerraformRestriction ? [...args, "-get=false"] : args;
}

/** Handle ENOENT errors: attempt auto-install, or return skip result. */
async function handleBinaryNotFound(
  binary: string,
  args: string[],
  config: BinaryVerificationConfig,
  tmpDir: string,
  networkPermission: string | undefined,
  onBinaryMissing?: OnBinaryMissing,
): Promise<{ rawOutput: string; earlyReturn?: VerificationResult; shouldBreak?: boolean }> {
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

/** Extract raw output from an exec error. */
function extractErrorOutput(err: unknown): string {
  const execErr = err as { stdout?: string; stderr?: string };
  return execErr.stdout || execErr.stderr || (err instanceof Error ? err.message : String(err));
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
  const finalArgs = applyNetworkSafety(binary, args, networkPermission);

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
      return handleBinaryNotFound(binary, args, config, tmpDir, networkPermission, onBinaryMissing);
    }
    return { rawOutput: extractErrorOutput(err), shouldBreak: true };
  }
}

/** Write input files (multi or single) into a temp directory. */
function writeFilesToTmpDir(
  tmpDir: string,
  files: Record<string, string> | undefined,
  filename: string,
  content: string,
): void {
  if (files && Object.keys(files).length > 0) {
    const resolvedTmpDir = path.resolve(tmpDir);
    for (const [fname, fcontent] of Object.entries(files)) {
      // Skip directory-only paths (trailing /) — these cause EISDIR errors
      if (fname.endsWith("/")) continue;
      // Skip .gitkeep/.keep placeholders
      if (/\.(gitkeep|keep)$/.test(fname)) continue;
      const filePath = path.resolve(resolvedTmpDir, fname);
      // Prevent LLM-controlled path traversal outside the temp directory
      if (!filePath.startsWith(resolvedTmpDir + path.sep)) continue;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, fcontent, "utf-8");
    }
  } else {
    fs.writeFileSync(path.join(tmpDir, filename), content, "utf-8");
  }
}

/** Validate pre-conditions for binary verification. Returns a skip result or null. */
function checkVerificationPreConditions(
  config: BinaryVerificationConfig,
  childProcessPermission: string | undefined,
): VerificationResult | null {
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
  return null;
}

/**
 * Run binary verification in a temp directory.
 * Returns VerificationResult with rich parsed issues.
 */
export async function verifyWithBinary(input: BinaryVerifierInput): Promise<VerificationResult> {
  const { content, filename, config, severityMapping, childProcessPermission, networkPermission } =
    input;

  const preCheck = checkVerificationPreConditions(config, childProcessPermission);
  if (preCheck) return preCheck;

  const parser = getParser(config.parser)!;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-verify-"));
  try {
    writeFilesToTmpDir(tmpDir, input.files, filename, content);

    // Resolve {entryFile} placeholder in the verification command.
    // This allows .dops skills to reference the actual generated filename
    // instead of hardcoding (e.g., ansible playbooks may be named dynamically).
    // Returns null when only non-entry files are present (e.g., inventory-only output).
    const resolvedCommand = resolveCommandPlaceholders(config.command, input.files, filename);
    if (resolvedCommand === null) {
      return { passed: true, tool: config.parser, issues: [], rawOutput: "" };
    }

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

/** Patterns for files that are NOT valid verification entry points (e.g., inventory, vars, templates). */
const NON_ENTRY_PATTERNS = [
  /inventory/i,
  /hosts\.(ya?ml)$/i,
  /group_vars\//i,
  /host_vars\//i,
  /defaults\//,
  /\bvars\//,
  /\bmeta\//,
  /\.(j2|cfg|ini)$/,
  /\broles\//, // Role files (tasks, handlers, etc.) are not standalone playbooks
  /\.gitkeep$/,
];

/** Check whether a filename is a non-entry file (inventory, vars, templates, etc.). */
function isNonEntryFile(filename: string): boolean {
  return NON_ENTRY_PATTERNS.some((p) => p.test(filename));
}

/**
 * Resolve template placeholders in a verification command.
 *
 * Supported placeholders:
 * - `{entryFile}` — resolves to the main entry file from the files map.
 *   For multi-file outputs, picks the top-level .yml/.yaml file (prefers site.yml/playbook.yml).
 *   Excludes inventory, vars, and template files from selection.
 *   Returns null if no valid entry file can be found (caller should skip verification).
 */
function resolveCommandPlaceholders(
  command: string,
  files: Record<string, string> | undefined,
  fallbackFilename: string,
): string | null {
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
    } else {
      // Filter out non-entry files (inventory, vars, templates)
      const candidates = fileNames.filter((f) => !isNonEntryFile(f));
      const topCandidates = candidates.filter((f) => !f.includes("/"));
      if (topCandidates.length > 0) {
        const yamlFile = topCandidates.find((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
        entryFile = yamlFile ?? topCandidates[0];
      } else if (candidates.length > 0) {
        entryFile = candidates[0];
      } else if (topLevel.length > 0) {
        const yamlFile = topLevel.find((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
        entryFile = yamlFile ?? topLevel[0];
      } else {
        entryFile = fileNames[0];
      }
    }
  }

  // If the resolved entry file is still a non-entry file, skip verification
  if (isNonEntryFile(entryFile)) return null;

  return command.replaceAll("{entryFile}", entryFile);
}

export interface RunVerificationOptions {
  data: unknown;
  serializedContent: string;
  filename: string;
  verificationConfig: VerificationConfig | undefined;
  permissions: { child_process?: "required" | "none"; network?: "required" | "none" };
  structuralIssues: VerificationIssue[];
  skillName: string;
  files?: Record<string, string>;
  onBinaryMissing?: OnBinaryMissing;
}

/**
 * Run full verification: structural rules + optional binary verification.
 */
export async function runVerification(opts: RunVerificationOptions): Promise<VerificationResult> {
  const {
    serializedContent,
    filename,
    verificationConfig,
    permissions,
    structuralIssues,
    skillName,
    files,
    onBinaryMissing,
  } = opts;
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
    tool: skillName,
    issues: allIssues,
  };
}
