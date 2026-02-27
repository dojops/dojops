import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse docker compose config output into VerificationIssues.
 * On success, docker compose config prints the resolved config (no issues).
 * On failure, stderr contains error messages.
 */
export function parseDockerComposeConfig(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("error") || lower.includes("invalid")) {
      issues.push({ severity: "error", message: line });
    } else if (lower.includes("warning")) {
      issues.push({ severity: "warning", message: line });
    }
  }

  return issues;
}
