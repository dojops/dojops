import type { VerificationIssue } from "@dojops/sdk";
import { SeverityMapping } from "./index";

const DEFAULT_ERROR_PATTERNS = ["error", "fatal", "emerg"];
const DEFAULT_WARNING_PATTERNS = ["warning", "warn"];
const DEFAULT_INFO_PATTERNS = ["info", "note", "suggestion"];

/**
 * Parse generic stderr output into VerificationIssues using severity patterns.
 */
export function parseGenericStderr(
  output: string,
  severityMapping?: SeverityMapping,
): VerificationIssue[] {
  const errorPatterns = severityMapping?.error ?? DEFAULT_ERROR_PATTERNS;
  const warningPatterns = severityMapping?.warning ?? DEFAULT_WARNING_PATTERNS;
  const infoPatterns = severityMapping?.info ?? DEFAULT_INFO_PATTERNS;

  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (errorPatterns.some((p) => lower.includes(p))) {
      issues.push({ severity: "error", message: truncate(line) });
    } else if (warningPatterns.some((p) => lower.includes(p))) {
      issues.push({ severity: "warning", message: truncate(line) });
    } else if (infoPatterns.some((p) => lower.includes(p))) {
      issues.push({ severity: "info", message: truncate(line) });
    }
  }

  // If no patterns matched but there's output, treat the whole thing as an error
  if (issues.length === 0 && lines.length > 0) {
    issues.push({ severity: "error", message: truncate(output, 500) });
  }

  return issues;
}

function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
