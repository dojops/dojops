import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse systemd-analyze verify output into VerificationIssues.
 * Lines containing "warning" are warnings, everything else with content is an error.
 */
export function parseSystemdAnalyze(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("warning")) {
      issues.push({ severity: "warning", message: line });
    } else if (lower.includes("error") || lower.includes("failed")) {
      issues.push({ severity: "error", message: line });
    } else if (lower.includes("[") || lower.includes(":")) {
      // Diagnostic output lines are typically errors
      issues.push({ severity: "error", message: line });
    }
  }

  return issues;
}
