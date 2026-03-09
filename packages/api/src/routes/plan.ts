import { Router } from "express";
import { LLMProvider } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { decompose, PlannerExecutor, TaskGraph, PlannerResult } from "@dojops/planner";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import type { CriticCallback } from "@dojops/executor";
import { HistoryStore, logRouteError } from "../store";
import { PlanRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

/** Build optional critic for self-repair loop. */
async function buildCritic(provider: LLMProvider): Promise<CriticCallback | undefined> {
  try {
    const { CriticAgent } = await import("@dojops/core");
    return new CriticAgent(provider);
  } catch {
    return undefined;
  }
}

/** Compute basic task risk from tool name and description patterns. */
function classifyTaskRiskBasic(
  tool: string,
  description: string,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const desc = description;
  if (/secret|credential|\bpassword\b|\btoken\b|\bkey.?rotation\b/i.test(desc)) return "CRITICAL";
  if (/\bprod(uction)?\b.*\b(deploy|rollback|destroy|delete)\b/i.test(desc)) return "CRITICAL";
  if (
    /iam|policy|security.?group|network.?acl|state.?backend|production|\bprod\b|rbac|\brole\b|permission/i.test(
      desc,
    )
  )
    return "HIGH";
  if (
    [
      "terraform",
      "dockerfile",
      "kubernetes",
      "helm",
      "docker-compose",
      "ansible",
      "nginx",
      "systemd",
    ].includes(tool)
  )
    return "MEDIUM";
  return "LOW";
}

/** Run auto-approve safe execution for completed plan tasks. */
async function autoApproveExecute(
  graph: TaskGraph,
  planResult: PlannerResult,
  tools: DevOpsTool[],
  signal: AbortSignal,
  provider: LLMProvider,
): Promise<void> {
  const critic = await buildCritic(provider);
  const safeExecutor = new SafeExecutor({
    policy: {
      allowWrite: true,
      requireApproval: false,
      approvalMode: "risk-based",
      autoApproveRiskLevel: "MEDIUM",
      timeoutMs: 60_000,
      executeTimeoutMs: 10 * 60_000,
      enforceDevOpsAllowlist: true,
      maxRepairAttempts: 3,
    },
    approvalHandler: new AutoApproveHandler(),
    critic,
  });

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  for (const taskResult of planResult.results) {
    if (signal.aborted) break;
    if (taskResult.status !== "completed") continue;
    const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);
    if (!taskNode) continue;
    const tool = toolMap.get(taskNode.tool);
    if (!tool?.execute) continue;
    const risk = classifyTaskRiskBasic(taskNode.tool, taskNode.description);
    await safeExecutor.executeTask(taskResult.taskId, tool, taskNode.input, { risk });
  }
}

/** Execute the plan with an abort-controller timeout and optional auto-approve. */
async function executePlanWithTimeout(
  graph: TaskGraph,
  tools: DevOpsTool[],
  autoApprove: boolean,
  provider: LLMProvider,
): Promise<PlannerResult> {
  const timeoutMs = Number.parseInt(process.env.DOJOPS_PLAN_TIMEOUT_MS ?? "300000", 10);

  // A9: Use AbortController instead of Promise.race to avoid abandoned promises
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let planResult: PlannerResult;
  try {
    const executor = new PlannerExecutor(tools);
    planResult = await executor.execute(graph);

    if (autoApprove && !controller.signal.aborted) {
      await autoApproveExecute(graph, planResult, tools, controller.signal, provider);
    }
  } finally {
    clearTimeout(timer);
  }

  if (controller.signal.aborted) {
    throw new Error("Plan execution timeout");
  }

  return planResult;
}

export function createPlanRouter(
  provider: LLMProvider,
  tools: DevOpsTool[],
  store: HistoryStore,
): Router {
  const router = Router();

  router.post("/", validateBody(PlanRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { goal, execute, autoApprove } = req.body;

      // C-8: autoApprove requires the caller to be authenticated (not just server config)
      if (autoApprove && !res.locals.authenticated) {
        res.status(403).json({ error: "autoApprove requires authenticated request" });
        return;
      }

      const graph = await decompose(goal, provider, tools);

      const result = execute
        ? await executePlanWithTimeout(graph, tools, autoApprove, provider)
        : undefined;

      const response = { graph, result };

      const entry = store.add({
        type: "plan",
        request: { goal, execute, autoApprove },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...response, historyId: entry.id });
    } catch (err) {
      logRouteError(store, "plan", req.body, start, err);
      next(err);
    }
  });

  return router;
}
