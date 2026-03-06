import { ScanCategory, ScanFinding, ScannerResult, ScanSeverity } from "./types";

/** Create a parse-error finding when JSON output cannot be parsed. */
export function parseErrorFinding(tool: string, category: ScanCategory): ScanFinding {
  return {
    id: `${tool}-parse-error`,
    tool,
    severity: "MEDIUM",
    category,
    message: `Failed to parse ${tool} output. The tool may have produced unexpected output format.`,
    autoFixAvailable: false,
  };
}

/** Create a skipped scanner result with the given tool name and reason. */
export function skippedResult(tool: string, skipReason: string): ScannerResult {
  return { tool, findings: [], skipped: true, skipReason };
}

/** Check if an error is an ENOENT (command not found). */
export function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Map lint-tool levels (error/warning/info/style) to ScanSeverity.
 * Shared by shellcheck and hadolint scanners.
 */
export function mapLintLevel(level: string): ScanSeverity {
  switch (level) {
    case "error":
      return "HIGH";
    case "info":
    case "style":
      return "LOW";
    case "warning":
    default:
      return "MEDIUM";
  }
}

/**
 * Map standard severity strings (CRITICAL/HIGH/MEDIUM/LOW/INFO/UNKNOWN)
 * to ScanSeverity. Shared by trivy, checkov, and similar scanners.
 */
export function mapTrivySeverity(severity?: string): ScanSeverity {
  if (!severity) return "MEDIUM";
  switch (severity.toUpperCase()) {
    case "CRITICAL":
      return "CRITICAL";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    case "LOW":
    case "INFO":
    case "UNKNOWN":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
