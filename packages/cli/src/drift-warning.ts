export interface DriftWarning {
  tool: string;
  message: string;
}

const DRIFT_AWARE_TOOLS = new Map<string, string>([
  ["terraform", "Remote state not inspected. Run `terraform plan` to check for drift."],
  ["kubernetes", "Cluster state not inspected. Run `kubectl diff` to check for drift."],
  ["helm", "Release state not inspected. Run `helm diff` to check for drift."],
  ["ansible", "Host state not inspected. Run `ansible --check` to verify convergence."],
]);

export function getDriftWarnings(toolNames: string[]): DriftWarning[] {
  const warnings: DriftWarning[] = [];
  const seen = new Set<string>();

  for (const tool of toolNames) {
    const message = DRIFT_AWARE_TOOLS.get(tool);
    if (message && !seen.has(tool)) {
      seen.add(tool);
      warnings.push({ tool, message });
    }
  }

  return warnings;
}
