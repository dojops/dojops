import type { VerificationIssue } from "@dojops/sdk";

interface HadolintEntry {
  level: string;
  message: string;
  line: number;
  code: string;
}

/**
 * Parse hadolint --format json output into VerificationIssues.
 */
export function parseHadolintJson(output: string): VerificationIssue[] {
  let entries: HadolintEntry[];
  try {
    entries = JSON.parse(output);
  } catch {
    return [{ severity: "error", message: "Failed to parse hadolint JSON output" }];
  }

  if (!Array.isArray(entries)) {
    return [{ severity: "error", message: "Expected hadolint output to be an array" }];
  }

  return entries.map((entry) => ({
    severity: mapHadolintSeverity(entry.level),
    message: entry.message,
    line: entry.line,
    rule: entry.code,
  }));
}

function mapHadolintSeverity(level: string): "error" | "warning" | "info" {
  switch (level.toLowerCase()) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "info":
    case "style":
      return "info";
    default:
      return "warning";
  }
}
