import type { VerificationIssue } from "@dojops/sdk";
import { scanLinesForIssues } from "./scan-lines";

/**
 * Parse promtool check config / check rules output into VerificationIssues.
 * Lines containing "FAILED" or "error" are errors, "WARNING" lines are warnings.
 */
export function parsePromtool(output: string): VerificationIssue[] {
  return scanLinesForIssues(output, {
    errorPatterns: ["failed", "error"],
    warningPatterns: ["warning"],
    skipPatterns: ["success"],
  });
}
