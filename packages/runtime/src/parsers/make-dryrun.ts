import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse make -n (dry-run) output into VerificationIssues.
 * Lines containing "Error" or "***" are errors, "warning" lines are warnings.
 */
export function parseMakeDryrun(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (line.includes("***") || lower.includes("error")) {
      issues.push({ severity: "error", message: line });
    } else if (lower.includes("warning")) {
      issues.push({ severity: "warning", message: line });
    }
  }

  return issues;
}
