import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse promtool check config / check rules output into VerificationIssues.
 * Lines containing "FAILED" or "error" are errors, "WARNING" lines are warnings.
 */
export function parsePromtool(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("failed") || lower.includes("error")) {
      issues.push({ severity: "error", message: line });
    } else if (lower.includes("warning")) {
      issues.push({ severity: "warning", message: line });
    } else if (lower.includes("success")) {
      // Success message, skip
    }
  }

  return issues;
}
