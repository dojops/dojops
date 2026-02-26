import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import { ScannerResult, ScanFinding, ScanSeverity } from "../types";

interface CheckovFailedCheck {
  check_id: string;
  check_result: { result: string };
  file_path: string;
  file_line_range: [number, number];
  resource: string;
  check_class?: string;
  guideline?: string;
  severity?: string;
}

interface CheckovOutput {
  results?: {
    failed_checks?: CheckovFailedCheck[];
  };
}

export async function scanCheckov(projectPath: string): Promise<ScannerResult> {
  let rawOutput: string;
  try {
    rawOutput = execFileSync(
      "checkov",
      ["-d", projectPath, "--output", "json", "--quiet", "--compact"],
      {
        encoding: "utf-8",
        timeout: 180_000,
        stdio: "pipe",
      },
    );
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return {
        tool: "checkov",
        findings: [],
        skipped: true,
        skipReason: "checkov not found",
      };
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return {
        tool: "checkov",
        findings: [],
        skipped: true,
        skipReason: `checkov failed: ${execErr.stderr ?? "unknown error"}`,
      };
    }
  }

  const findings: ScanFinding[] = [];

  try {
    // checkov may output an array of results (one per framework) or a single object
    const parsed = JSON.parse(rawOutput);
    const outputs: CheckovOutput[] = Array.isArray(parsed) ? parsed : [parsed];

    for (const output of outputs) {
      if (output.results?.failed_checks) {
        for (const check of output.results.failed_checks) {
          findings.push({
            id: `checkov-${crypto.randomUUID().slice(0, 8)}`,
            tool: "checkov",
            severity: mapSeverity(check.severity),
            category: "IAC",
            file: check.file_path,
            line: check.file_line_range?.[0],
            message: `${check.check_id}: ${check.resource}`,
            recommendation: check.guideline ?? "Review IaC configuration",
            autoFixAvailable: false,
          });
        }
      }
    }
  } catch {
    findings.push({
      id: "checkov-parse-error",
      tool: "checkov",
      severity: "LOW",
      category: "SECURITY",
      message:
        "Failed to parse checkov output. The tool may have produced unexpected output format.",
      autoFixAvailable: false,
    });
  }

  return { tool: "checkov", findings, rawOutput };
}

function mapSeverity(severity?: string): ScanSeverity {
  if (!severity) return "MEDIUM";
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
    case "INFO":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}
