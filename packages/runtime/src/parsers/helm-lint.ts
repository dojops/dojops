import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse helm lint stdout output into VerificationIssues.
 * Lines with [ERROR] are errors, [WARNING] are warnings.
 */
export function parseHelmLint(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    if (line.includes("[ERROR]")) {
      issues.push({
        severity: "error",
        message: line.replace("[ERROR]", "").trim(),
      });
    } else if (line.includes("[WARNING]")) {
      issues.push({
        severity: "warning",
        message: line.replace("[WARNING]", "").trim(),
      });
    } else if (line.includes("[INFO]")) {
      issues.push({
        severity: "info",
        message: line.replace("[INFO]", "").trim(),
      });
    }
  }

  return issues;
}
