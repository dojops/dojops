import type { VerificationIssue } from "@dojops/sdk";
import { scanLinesForIssues } from "./scan-lines";

/**
 * Parse docker compose config output into VerificationIssues.
 * On success, docker compose config prints the resolved config (no issues).
 * On failure, stderr contains error messages.
 */
export function parseDockerComposeConfig(output: string): VerificationIssue[] {
  return scanLinesForIssues(output, {
    errorPatterns: ["error", "invalid"],
    warningPatterns: ["warning"],
  });
}
