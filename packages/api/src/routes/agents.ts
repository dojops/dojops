import { Router } from "express";
import { AgentRouter } from "@dojops/core";

export function createAgentsRouter(
  agentRouter: AgentRouter,
  customAgentNames?: Set<string>,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const agents = agentRouter.getAgents().map((agent) => ({
      name: agent.name,
      domain: agent.domain,
      description: agent.description ?? null,
      keywords: agent.keywords,
      type: customAgentNames?.has(agent.name) ? "custom" : "built-in",
    }));

    res.json({ agents });
  });

  return router;
}
