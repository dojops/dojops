export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

interface TaskInfo {
  tool: string;
  description: string;
}

const HIGH_RISK_PATTERNS = [
  /iam/i,
  /policy/i,
  /security.?group/i,
  /network.?acl/i,
  /state.?backend/i,
  /production/i,
  /\bprod\b/i,
  /secret/i,
  /credential/i,
  /rbac/i,
  /\brole\b/i,
  /permission/i,
];

const MEDIUM_RISK_TOOLS = new Set([
  "terraform",
  "dockerfile",
  "kubernetes",
  "helm",
  "docker-compose",
  "ansible",
  "nginx",
  "systemd",
]);

export function classifyPlanRisk(tasks: TaskInfo[]): RiskLevel {
  let maxRisk: RiskLevel = "LOW";

  for (const task of tasks) {
    // Check HIGH risk keywords in description
    if (HIGH_RISK_PATTERNS.some((p) => p.test(task.description))) {
      return "HIGH";
    }

    // Check tool-based risk
    if (MEDIUM_RISK_TOOLS.has(task.tool) && maxRisk === "LOW") {
      maxRisk = "MEDIUM";
    }
  }

  return maxRisk;
}
