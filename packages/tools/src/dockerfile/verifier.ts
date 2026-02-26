import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VerificationResult, VerificationIssue } from "@dojops/sdk";

interface HadolintResult {
  line: number;
  code: string;
  message: string;
  column: number;
  file: string;
  level: string;
}

export async function verifyDockerfile(dockerfile: string): Promise<VerificationResult> {
  const tmpFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "dojops-hadolint-")),
    "Dockerfile",
  );

  try {
    fs.writeFileSync(tmpFile, dockerfile, "utf-8");

    let rawOutput: string;
    try {
      rawOutput = execFileSync("hadolint", ["--format", "json", tmpFile], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if (isENOENT(err)) {
        return {
          passed: true,
          tool: "hadolint",
          issues: [{ severity: "warning", message: "hadolint not found — skipped" }],
        };
      }
      // hadolint exits non-zero when issues found, but still outputs JSON to stdout
      const execErr = err as { stdout?: string; stderr?: string; status?: number };
      rawOutput = execErr.stdout ?? "";
      if (!rawOutput) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          passed: false,
          tool: "hadolint",
          issues: [{ severity: "error", message: `hadolint failed: ${msg}` }],
          rawOutput: execErr.stderr,
        };
      }
    }

    let results: HadolintResult[];
    try {
      results = JSON.parse(rawOutput);
    } catch {
      return {
        passed: false,
        tool: "hadolint",
        issues: [{ severity: "error", message: "Failed to parse hadolint JSON output" }],
        rawOutput,
      };
    }

    const issues: VerificationIssue[] = results.map((r) => ({
      severity: mapLevel(r.level),
      message: r.message,
      line: r.line,
      rule: r.code,
    }));

    const hasErrors = issues.some((i) => i.severity === "error");

    return {
      passed: !hasErrors,
      tool: "hadolint",
      issues,
      rawOutput,
    };
  } finally {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  }
}

function mapLevel(level: string): VerificationIssue["severity"] {
  switch (level) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
