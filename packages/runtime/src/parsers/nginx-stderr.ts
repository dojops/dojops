import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse nginx -t stderr output into VerificationIssues.
 */
export function parseNginxStderr(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    if (line.includes("[emerg]") || line.includes("[crit]")) {
      issues.push({ severity: "error", message: line });
    } else if (line.includes("[error]")) {
      issues.push({ severity: "error", message: line });
    } else if (line.includes("[warn]")) {
      issues.push({ severity: "warning", message: line });
    } else if (line.includes("test is successful")) {
      // Success message, skip
    } else if (line.includes("error") || line.includes("failed")) {
      issues.push({ severity: "error", message: line });
    }
  }

  return issues;
}
