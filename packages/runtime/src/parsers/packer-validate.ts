import type { VerificationIssue } from "@dojops/sdk";

/** Known success messages from packer validate. */
const SUCCESS_PATTERNS = [
  "the configuration is valid",
  "configuration is valid",
  "template validated successfully",
];

/**
 * Parse packer validate output into VerificationIssues.
 *
 * Packer validate outputs "The configuration is valid." on success (exit 0)
 * and "Error: ..." lines on failure (non-zero exit). The generic-stderr parser
 * incorrectly treats success messages as errors because they don't match any
 * severity keyword and hit the catch-all.
 */
export function parsePackerValidate(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Skip known success messages
    if (SUCCESS_PATTERNS.some((p) => lower.includes(p))) continue;

    // Packer prefixes errors with "Error:" and warnings with "Warning:"
    if (lower.startsWith("error:") || lower.includes("error(s) occurred")) {
      issues.push({ severity: "error", message: truncate(line) });
    } else if (lower.startsWith("warning:") || lower.includes("warning:")) {
      issues.push({ severity: "warning", message: truncate(line) });
    } else if (lower.includes("error") || lower.includes("fatal")) {
      issues.push({ severity: "error", message: truncate(line) });
    }
    // Lines that don't match any pattern are ignored (context/details)
  }

  return issues;
}

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
