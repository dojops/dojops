import type { VerificationIssue } from "@dojops/sdk";

/**
 * Parse generic JSON output into VerificationIssues.
 * Expects JSON with a top-level array or an object with a list field.
 */
export function parseGenericJson(output: string): VerificationIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [{ severity: "error", message: "Failed to parse JSON verification output" }];
  }

  const issues: VerificationIssue[] = [];

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      issues.push(extractIssue(item));
    }
  } else if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    // Look for common list fields
    const listFields = ["errors", "warnings", "issues", "diagnostics", "results"];
    for (const field of listFields) {
      if (Array.isArray(obj[field])) {
        for (const item of obj[field] as unknown[]) {
          issues.push(extractIssue(item));
        }
      }
    }
    // If no list fields found, check for error/message at top level
    if (issues.length === 0 && (obj.error || obj.message)) {
      issues.push(extractIssue(obj));
    }
  }

  return issues;
}

function extractIssue(item: unknown): VerificationIssue {
  if (typeof item === "string") {
    return { severity: "error", message: item };
  }
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    return {
      severity: mapSeverity(obj.severity ?? obj.level ?? obj.type),
      message: String(obj.message ?? obj.summary ?? obj.error ?? JSON.stringify(item)),
      line: typeof obj.line === "number" ? obj.line : undefined,
      rule:
        typeof obj.rule === "string" || typeof obj.code === "string"
          ? String(obj.rule ?? obj.code)
          : undefined,
    };
  }
  return { severity: "error", message: String(item) };
}

function mapSeverity(value: unknown): "error" | "warning" | "info" {
  if (typeof value !== "string") return "error";
  const lower = value.toLowerCase();
  if (lower === "error" || lower === "fatal") return "error";
  if (lower === "warning" || lower === "warn") return "warning";
  if (lower === "info" || lower === "note") return "info";
  return "error";
}
