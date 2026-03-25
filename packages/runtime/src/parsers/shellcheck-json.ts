import type { VerificationIssue } from "@dojops/sdk";
interface ShellCheckEntry {
  file: string;
  line: number;
  column: number;
  level: string;
  code: number;
  message: string;
}

/**
 * Parse ShellCheck JSON output (--format=json) into VerificationIssues.
 */
export function parseShellcheckJson(output: string): VerificationIssue[] {
  if (!output.trim()) return [];

  let entries: ShellCheckEntry[];
  try {
    entries = JSON.parse(output);
  } catch {
    // If not valid JSON, treat as a single error
    if (output.trim().length > 0) {
      return [{ severity: "error", message: output.trim().slice(0, 300) }];
    }
    return [];
  }

  if (!Array.isArray(entries)) return [];

  return entries.map((entry) => {
    const severity = mapSeverity(entry.level);
    const location = `${entry.file}:${entry.line}:${entry.column}`;
    const message = `SC${entry.code}: ${entry.message} (${location})`;
    return { severity, message };
  });
}

function mapSeverity(level: string): "error" | "warning" | "info" {
  switch (level) {
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
