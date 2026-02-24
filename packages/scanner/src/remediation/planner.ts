import type { LLMProvider } from "@dojops/core";
import { ScanFinding, RemediationPlan, RemediationPlanSchema } from "../types";

export async function planRemediation(
  findings: ScanFinding[],
  provider: LLMProvider,
): Promise<RemediationPlan> {
  // Only send HIGH and CRITICAL findings to the LLM
  const critical = findings.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL");

  if (critical.length === 0) {
    return { fixes: [] };
  }

  const findingsSummary = critical
    .map(
      (f) =>
        `- [${f.id}] ${f.severity} (${f.category}) ${f.tool}: ${f.message}` +
        (f.file ? ` in ${f.file}${f.line ? `:${f.line}` : ""}` : "") +
        (f.recommendation ? `\n  Recommendation: ${f.recommendation}` : ""),
    )
    .join("\n");

  const response = await provider.generate({
    system: `You are a DevOps security remediation specialist. Given a list of security findings, generate a remediation plan with specific fix actions. Each fix should reference the finding ID, specify the file to modify, the action to take, a code patch (if applicable), and a description of what the fix does. Only generate fixes for findings that have actionable remediations. For dependency updates, the patch should be the updated version constraint. For config changes, provide the corrected config snippet.`,
    prompt: `Generate a remediation plan for these security findings:\n\n${findingsSummary}`,
    schema: RemediationPlanSchema,
  });

  if (response.parsed) {
    return response.parsed as RemediationPlan;
  }

  // Fallback: try to parse from content
  try {
    const result = RemediationPlanSchema.safeParse(JSON.parse(response.content));
    if (result.success) return result.data;
  } catch {
    // LLM didn't produce valid JSON
  }

  return { fixes: [] };
}
