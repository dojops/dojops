import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse ansible-playbook --syntax-check output into VerificationIssues.
 * Lines containing "ERROR" are errors, "WARNING" are warnings.
 */
export function parseAnsibleSyntax(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("error")) {
      issues.push({ severity: "error", message: line });
    } else if (lower.includes("warning")) {
      issues.push({ severity: "warning", message: line });
    } else if (lower.includes("syntax ok")) {
      // Success message, skip
    }
  }

  return issues;
}
