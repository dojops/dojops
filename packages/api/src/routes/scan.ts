import { Router } from "express";
import { runScan } from "@dojops/scanner";
import type { ScanType } from "@dojops/scanner";
import { HistoryStore } from "../store";
import { ScanRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

export function createScanRouter(store: HistoryStore): Router {
  const router = Router();

  router.post("/", validateBody(ScanRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { target, scanType } = req.body as { target?: string; scanType: ScanType };
      const projectPath = target ?? process.cwd();

      const report = await runScan(projectPath, scanType);

      const entry = store.add({
        type: "scan",
        request: { target: projectPath, scanType },
        response: report,
        durationMs: Date.now() - start,
        success: true,
      });

      res.json({ ...report, historyId: entry.id });
    } catch (err) {
      store.add({
        type: "scan",
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
