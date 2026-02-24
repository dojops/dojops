import { Router } from "express";
import { InfraDiffAnalyzer } from "@dojops/core";
import { HistoryStore } from "../store";
import { DiffRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

export function createDiffRouter(analyzer: InfraDiffAnalyzer, store: HistoryStore): Router {
  const router = Router();

  router.post("/", validateBody(DiffRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { diff, before, after } = req.body;

      let analysis;
      if (before && after) {
        analysis = await analyzer.compare(before, after);
      } else {
        analysis = await analyzer.analyze(diff);
      }

      const response = { analysis };

      const entry = store.add({
        type: "diff",
        request: { diff, before, after },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...response, historyId: entry.id });
    } catch (err) {
      store.add({
        type: "diff",
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
