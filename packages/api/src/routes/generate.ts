import { Router } from "express";
import { AgentRouter } from "@dojops/core";
import type { LLMProvider } from "@dojops/core";
import { HistoryStore, logRouteError } from "../store";
import { GenerateRequestSchema } from "../schemas";
import { validateBody } from "../middleware";
import { runReviewPipeline } from "./review";

/**
 * POST /api/generate
 *
 * When the agent router selects the devsecops-reviewer agent and a rootDir
 * is available, this route automatically runs the full review pipeline
 * (tool execution → LLM analysis) instead of just text generation.
 */
export function createGenerateRouter(
  agentRouter: AgentRouter,
  store: HistoryStore,
  provider?: LLMProvider,
  rootDir?: string,
  context7Provider?: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  },
): Router {
  const router = Router();

  router.post("/", validateBody(GenerateRequestSchema), async (req, res, next) => {
    const start = Date.now();
    try {
      const { prompt, temperature } = req.body;

      const route = agentRouter.route(prompt);

      // When routed to devsecops-reviewer and we have a project root,
      // run the full review pipeline with tool execution
      if (route.agent.domain === "devops-review" && rootDir && provider) {
        const result = await runReviewPipeline({
          provider,
          projectRoot: rootDir,
          autoDiscover: true,
          useContext7: process.env.DOJOPS_CONTEXT_ENABLED === "true",
          context7Provider,
        });

        const response = {
          content: JSON.stringify(result.report, null, 2),
          report: result.report,
          toolsRun: result.toolResults.map((r) => ({
            tool: r.tool,
            file: r.file,
            passed: r.passed,
            issueCount: r.issues.length,
          })),
          filesReviewed: result.filesReviewed,
          agent: {
            name: route.agent.name,
            domain: route.agent.domain,
            confidence: route.confidence,
            reason: route.reason,
          },
        };

        const entry = store.add({
          type: "review",
          request: { prompt },
          response,
          durationMs: Date.now() - start,
          success: true,
        });

        res.json({ ...response, historyId: entry.id });
        return;
      }

      // Standard text generation for all other agents
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
