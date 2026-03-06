import { ScannerResult, ScanFinding } from "../types";
import { execFileAsync } from "../exec-async";
import { deterministicFindingId } from "../finding-id";
import { isENOENT, mapTrivySeverity, parseErrorFinding, skippedResult } from "../scanner-utils";

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
    const result = await execFileAsync(
      "checkov",
      ["-d", projectPath, "--output", "json", "--quiet", "--compact"],
      {
        encoding: "utf-8",
        timeout: 180_000,
      },
    );
    rawOutput = result.stdout;
  } catch (err: unknown) {
    if (isENOENT(err)) {
      return skippedResult("checkov", "checkov not found");
    }
    const execErr = err as { stdout?: string; stderr?: string };
    rawOutput = execErr.stdout ?? "";
    if (!rawOutput) {
      return skippedResult("checkov", `checkov failed: ${execErr.stderr ?? "unknown error"}`);
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
            id: deterministicFindingId(
              "checkov",
              check.check_id,
              check.file_path,
              check.resource || "",
            ),
            tool: "checkov",
            severity: mapTrivySeverity(check.severity),
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
    findings.push(parseErrorFinding("checkov", "SECURITY"));
  }

  return { tool: "checkov", findings, rawOutput };
}
