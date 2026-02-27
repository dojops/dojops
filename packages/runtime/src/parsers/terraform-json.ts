import type { VerificationIssue } from "@dojops/sdk";

interface TerraformDiagnostic {
  severity: "error" | "warning";
  summary: string;
  detail?: string;
}

interface TerraformValidateOutput {
  valid: boolean;
  diagnostics?: TerraformDiagnostic[];
}

/**
 * Parse terraform validate -json output into VerificationIssues.
 */
export function parseTerraformJson(output: string): VerificationIssue[] {
  let parsed: TerraformValidateOutput;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [{ severity: "error", message: "Failed to parse terraform validate JSON output" }];
  }

  return (parsed.diagnostics ?? []).map((d) => ({
    severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
    message: d.detail ? `${d.summary}: ${d.detail}` : d.summary,
  }));
}
