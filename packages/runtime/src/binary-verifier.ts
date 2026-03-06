import { runBin } from "./safe-exec";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { VerificationResult, VerificationIssue } from "@dojops/sdk";
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
function executeVerificationCommand(
  binary: string,
  args: string[],
  config: BinaryVerificationConfig,
  tmpDir: string,
  networkPermission: string | undefined,
): { rawOutput: string; earlyReturn?: VerificationResult; shouldBreak?: boolean } {
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
    const rawOutput = execErr.stdout || execErr.stderr || "";
    if (!rawOutput) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        rawOutput: "",
        earlyReturn: skipResult(config.parser, "error", `Verification failed: ${msg}`),
      };
    }
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
    fs.writeFileSync(path.join(tmpDir, filename), content, "utf-8");

    const commands = config.command.split(/\s*&&\s*/); // NOSONAR
    let rawOutput = "";
    for (let i = 0; i < commands.length; i++) {
      const parts = commands[i].split(/\s+/).filter(Boolean);
      const result = executeVerificationCommand(
        parts[0],
        parts.slice(1),
        config,
        tmpDir,
        networkPermission,
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
