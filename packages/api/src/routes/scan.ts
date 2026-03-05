import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { runScan } from "@dojops/scanner";
import type { ScanType } from "@dojops/scanner";
import { HistoryStore } from "../store";
import { ScanRequestSchema } from "../schemas";
import { validateBody } from "../middleware";

const SCAN_TIMEOUT_MS = Number.parseInt(process.env.DOJOPS_SCAN_TIMEOUT_MS ?? "120000", 10);

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

      // AbortController allows future scanner implementations to accept a signal
      // and terminate child processes (trivy, gitleaks, etc.) on timeout.
      // Currently runScan() does not accept a signal, so child processes will
      // finish in the background after timeout — but the timeout is cleaned up
      // on success to prevent leaked timers.
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, SCAN_TIMEOUT_MS);
      const timeoutPromise = new Promise<never>((_, reject) => {
        abortController.signal.addEventListener("abort", () => {
          reject(new Error("Scan timed out"));
        });
      });

      let report;
      try {
        report = await Promise.race([
          runScan(projectPath, scanType, context as Parameters<typeof runScan>[2]),
          timeoutPromise,
        ]);
      } finally {
        clearTimeout(timeoutId);
      }

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
