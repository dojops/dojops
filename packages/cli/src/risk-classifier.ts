import type { RiskLevel } from "@dojops/executor";
import { RISK_ORDER, classifyPathRisk } from "@dojops/executor";

export type { RiskLevel } from "@dojops/executor";
export { classifyPathRisk } from "@dojops/executor";

interface TaskInfo {
  tool: string;
  description: string;
}

const CRITICAL_RISK_PATTERNS = [
  /secret/i,
  /credential/i,
  /\bpassword\b/i,
  /\btoken\b/i,
  /\bkey.?rotation\b/i,
  /\bprod(uction)?\b.*\b(deploy|rollback|destroy|delete)\b/i,
];

const HIGH_RISK_PATTERNS = [
  /iam/i,
  /policy/i,
  /security.?group/i,
  /network.?acl/i,
  /state.?backend/i,
  /production/i,
  /\bprod\b/i,
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

/** Return the higher of two risk levels. */
function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

// ── Task risk classification ─────────────────────────────────────

/** Classify risk for a single task. */
export function classifyTaskRisk(task: TaskInfo): RiskLevel {
  if (CRITICAL_RISK_PATTERNS.some((p) => p.test(task.description))) {
    return "CRITICAL";
  }
  if (HIGH_RISK_PATTERNS.some((p) => p.test(task.description))) {
    return "HIGH";
  }
  if (MEDIUM_RISK_TOOLS.has(task.tool)) {
    return "MEDIUM";
  }
  return "LOW";
}

/** Classify combined risk for a task including its output paths. */
export function classifyEffectiveRisk(task: TaskInfo, outputPaths?: string[]): RiskLevel {
  const taskRisk = classifyTaskRisk(task);
  if (!outputPaths || outputPaths.length === 0) return taskRisk;

  let pathRisk: RiskLevel = "LOW";
  for (const p of outputPaths) {
    pathRisk = maxRiskLevel(pathRisk, classifyPathRisk(p));
  }
  return maxRiskLevel(taskRisk, pathRisk);
}

/** Classify aggregate risk for an entire plan (highest risk across all tasks). */
export function classifyPlanRisk(tasks: TaskInfo[]): RiskLevel {
  let maxRisk = "LOW" as RiskLevel;

  for (const task of tasks) {
    const taskRisk = classifyTaskRisk(task);
    if (taskRisk === "CRITICAL") return "CRITICAL";
    if (taskRisk === "HIGH") maxRisk = "HIGH";
    if (taskRisk === "MEDIUM" && maxRisk === "LOW") maxRisk = "MEDIUM";
  }

  return maxRisk;
}
