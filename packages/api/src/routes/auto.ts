import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { LLMProvider } from "@dojops/core";
import { AGENT_TOOLS } from "@dojops/core";
import type { DevOpsSkill } from "@dojops/sdk";
import { ToolExecutor } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
import type { HistoryStore } from "../store";
import { AutoRequestSchema } from "../schemas";

/** In-memory store for background run results (API only). */
const backgroundRuns = new Map<
  string,
  {
    status: "running" | "completed" | "failed";
    result?: unknown;
    error?: string;
    startedAt: string;
  }
>();

export function createAutoRouter(
  provider: LLMProvider,
  skills: DevOpsSkill[],
  store: HistoryStore,
  rootDir?: string,
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = AutoRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const { prompt, maxIterations, allowAllPaths, background } = parsed.data;
    const cwd = parsed.data.cwd ?? rootDir ?? process.cwd();

    const skillsMap = new Map(skills.map((s) => [s.name, s]));

    const toolExecutor = new ToolExecutor({
      policy: {
        allowWrite: true,
        allowedWritePaths: allowAllPaths ? [cwd] : [],
        deniedWritePaths: [],
        enforceDevOpsAllowlist: !allowAllPaths,
        allowNetwork: false,
        allowEnvVars: [],
        timeoutMs: 30_000,
        maxFileSizeBytes: 1_048_576,
        requireApproval: false,
        skipVerification: false,
        maxVerifyRetries: 0,
        approvalMode: "never",
        autoApproveRiskLevel: "MEDIUM",
        maxRepairAttempts: 0,
      },
      cwd,
      skills: skillsMap,
    });

    const loop = new AgentLoop({
      provider,
      toolExecutor,
      tools: AGENT_TOOLS,
      systemPrompt: `You are DojOps, an autonomous DevOps AI agent operating in: ${cwd}
Complete the user's task by reading files, making changes, and running commands.
Call the "done" tool with a summary when finished.`,
      maxIterations,
    });

    const start = Date.now();

    // ── Background mode: return immediately with a run ID ──────────
    if (background) {
      const runId = randomUUID();
      backgroundRuns.set(runId, { status: "running", startedAt: new Date().toISOString() });

      // Fire-and-forget — process continues in background
      loop
        .run(prompt)
        .then((result) => {
          store.add({
            type: "auto",
            request: { prompt, maxIterations, allowAllPaths },
            response: result,
            durationMs: Date.now() - start,
            success: result.success,
          });
          backgroundRuns.set(runId, {
            status: result.success ? "completed" : "failed",
            result,
            startedAt: backgroundRuns.get(runId)?.startedAt ?? new Date().toISOString(),
          });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          store.add({
            type: "auto",
            request: { prompt },
            response: null,
            durationMs: Date.now() - start,
            success: false,
            error: message,
          });
          backgroundRuns.set(runId, {
            status: "failed",
            error: message,
            startedAt: backgroundRuns.get(runId)?.startedAt ?? new Date().toISOString(),
          });
        });

      res.status(202).json({ runId, status: "running" });
      return;
    }

    // ── Synchronous mode (default) ─────────────────────────────────
    try {
      const result = await loop.run(prompt);

      store.add({
        type: "auto",
        request: { prompt, maxIterations, allowAllPaths },
        response: result,
        durationMs: Date.now() - start,
        success: result.success,
      });

      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.add({
        type: "auto",
        request: { prompt },
        response: null,
        durationMs: Date.now() - start,
        success: false,
        error: message,
      });
      res.status(500).json({ error: message });
    }
  });

  // ── GET /runs/:id — check background run status ─────────────────
  router.get("/runs/:id", (req, res) => {
    const run = backgroundRuns.get(req.params.id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    res.json({ runId: req.params.id, ...run });
  });

  return router;
}
