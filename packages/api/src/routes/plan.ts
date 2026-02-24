import { Router } from "express";
import { LLMProvider } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { decompose, PlannerExecutor } from "@dojops/planner";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { HistoryStore } from "../store";
import { PlanRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

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

      const graph = await decompose(goal, provider, tools);

      let result;
      if (execute) {
        const executor = new PlannerExecutor(tools);
        const planResult = await executor.execute(graph);

        if (autoApprove) {
          const safeExecutor = new SafeExecutor({
            policy: { allowWrite: true, requireApproval: false, timeoutMs: 60_000 },
            approvalHandler: new AutoApproveHandler(),
          });

          const toolMap = new Map(tools.map((t) => [t.name, t]));
          for (const taskResult of planResult.results) {
            if (taskResult.status !== "completed") continue;
            const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);
            if (!taskNode) continue;
            const tool = toolMap.get(taskNode.tool);
            if (!tool?.execute) continue;
            await safeExecutor.executeTask(taskResult.taskId, tool, taskNode.input);
          }
        }

        result = planResult;
      }

      const response = {
        graph,
        result: result ?? undefined,
      };

      const entry = store.add({
        type: "plan",
        request: { goal, execute, autoApprove },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...response, historyId: entry.id });
    } catch (err) {
      store.add({
        type: "plan",
        request: req.body,
        response: null,
        durationMs: Date.now() - start,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
      next(err);
    }
  });

  return router;
}
