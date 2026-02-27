import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse kubectl stderr output into VerificationIssues.
 */
export function parseKubectlStderr(output: string): VerificationIssue[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return [{ severity: "error", message: output || "kubectl validation failed" }];
  }

  return lines.map((line) => ({
    severity: "error" as const,
    message: line,
  }));
}
