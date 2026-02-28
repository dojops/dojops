import { Router } from "express";
import fs from "fs";
import path from "path";
import { runScan } from "@dojops/scanner";
import type { ScanType } from "@dojops/scanner";
import { HistoryStore } from "../store";
import { ScanRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

export function createScanRouter(store: HistoryStore, rootDir?: string): Router {
  const router = Router();
  let scanInProgress = false;

  router.post("/", validateBody(ScanRequestSchema), async (req, res, next) => {
    if (scanInProgress) {
      res.status(429).json({ error: "Scan already in progress" });
      return;
    }
    scanInProgress = true;
    const start = Date.now();
    try {
      const { target, scanType, context } = req.body as {
        target?: string;
        scanType: ScanType;
        context?: Record<string, unknown>;
      };
      const projectPath = target ?? process.cwd();
      let realResolved: string;
      let realRoot: string;
      try {
        realResolved = fs.realpathSync(path.resolve(projectPath));
        realRoot = fs.realpathSync(path.resolve(rootDir ?? process.cwd()));
      } catch {
        res.status(400).json({ error: "Target path does not exist" });
        return;
      }
      if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
        res.status(400).json({ error: "Target path must be within the project directory" });
        return;
      }

      const report = await runScan(projectPath, scanType, context as Parameters<typeof runScan>[2]);

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
    } finally {
      scanInProgress = false;
    }
  });

  return router;
}
