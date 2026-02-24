import { Router } from "express";
import { CIDebugger } from "@dojops/core";
import { HistoryStore } from "../store";
import { DebugCIRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

export function createDebugCIRouter(debugger_: CIDebugger, store: HistoryStore): Router {
  const router = Router();

  router.post("/", validateBody(DebugCIRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { log } = req.body;
      const diagnosis = await debugger_.diagnose(log);

      const response = { diagnosis };

      const entry = store.add({
        type: "debug-ci",
        request: { log },
        response,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...response, historyId: entry.id });
    } catch (err) {
      store.add({
        type: "debug-ci",
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
