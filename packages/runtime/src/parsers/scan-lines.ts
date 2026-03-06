import type { VerificationIssue } from "@dojops/sdk";

export interface ScanLinesOptions {
  /** Lowercase patterns that classify a line as an error. */
  errorPatterns: string[];
  /** Lowercase patterns that classify a line as a warning. */
  warningPatterns: string[];
  /** Lowercase patterns for lines to skip entirely (e.g. "success"). */
  skipPatterns?: string[];
}

/**
 * Shared line-scanning logic for simple verification parsers.
 * Splits output into trimmed non-empty lines, checks each against
 * error/warning/skip patterns (case-insensitive), and returns issues.
 */
export function scanLinesForIssues(output: string, opts: ScanLinesOptions): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const issues: VerificationIssue[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (opts.skipPatterns?.some((p) => lower.includes(p))) {
      continue;
    }

    if (opts.errorPatterns.some((p) => lower.includes(p))) {
      issues.push({ severity: "error", message: line });
    } else if (opts.warningPatterns.some((p) => lower.includes(p))) {
      issues.push({ severity: "warning", message: line });
    }
  }

  return issues;
}
