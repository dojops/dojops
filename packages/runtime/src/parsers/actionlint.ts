import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse actionlint output into VerificationIssues.
 *
 * actionlint outputs one issue per line in format:
 *   <file>:<line>:<col>: <message> [<rule>]
 *
 * Each line is treated as an error since actionlint only reports problems.
 */
export function parseActionlint(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    // Match actionlint format: file:line:col: message [rule]
    const match = line.match(/^(.+?):(\d+):(\d+):\s+(.+)$/);
    if (match) {
      const message = match[4];
      issues.push({
        severity: "error",
        message: message.length > 200 ? message.slice(0, 200) + "..." : message,
        line: parseInt(match[2], 10),
      });
    }
  }

  return issues;
}
