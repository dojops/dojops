import { Router } from "express";
import type { LLMProvider } from "@dojops/core";
import { AGENT_TOOLS } from "@dojops/core";
import type { DevOpsSkill } from "@dojops/sdk";
import { ToolExecutor } from "@dojops/executor";
import { AgentLoop } from "@dojops/session";
import type { HistoryStore } from "../store";
import { AutoRequestSchema } from "../schemas";

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

    const { prompt, maxIterations, allowAllPaths } = parsed.data;
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

  return router;
}
