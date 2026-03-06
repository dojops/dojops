import { Router } from "express";
import { AgentRouter } from "@dojops/core";
import { HistoryStore, logRouteError } from "../store";
import { GenerateRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

export function createGenerateRouter(agentRouter: AgentRouter, store: HistoryStore): Router {
  const router = Router();

  router.post("/", validateBody(GenerateRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { prompt, temperature } = req.body;

      const route = agentRouter.route(prompt);
      const result = await route.agent.run({ prompt, temperature });

      const response = {
        content: result.content,
        agent: {
          name: route.agent.name,
          domain: route.agent.domain,
          confidence: route.confidence,
          reason: route.reason,
        },
      };

      const entry = store.add({
        type: "generate",
        request: { prompt, temperature },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...response, historyId: entry.id });
    } catch (err) {
      logRouteError(store, "generate", req.body, start, err);
      next(err);
    }
  });

  return router;
}
