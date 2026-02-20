import express, { Express } from "express";
import cors from "cors";
import path from "path";
import { LLMProvider, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@oda/core";
import { DevOpsTool } from "@oda/sdk";
import { HistoryStore } from "./store";
import { errorHandler } from "./middleware";
import {
  createGenerateRouter,
  createPlanRouter,
  createDebugCIRouter,
  createDiffRouter,
  createAgentsRouter,
  createHistoryRouter,
} from "./routes";

export interface AppDependencies {
  provider: LLMProvider;
  tools: DevOpsTool[];
  router: AgentRouter;
  debugger: CIDebugger;
  diffAnalyzer: InfraDiffAnalyzer;
  store: HistoryStore;
  publicDir?: string;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Serve static dashboard files
  app.use(express.static(deps.publicDir ?? path.join(__dirname, "..", "public")));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      provider: deps.provider.name,
      tools: deps.tools.map((t) => t.name),
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  app.use("/api/generate", createGenerateRouter(deps.router, deps.store));
  app.use("/api/plan", createPlanRouter(deps.provider, deps.tools, deps.store));
  app.use("/api/debug-ci", createDebugCIRouter(deps.debugger, deps.store));
  app.use("/api/diff", createDiffRouter(deps.diffAnalyzer, deps.store));
  app.use("/api/agents", createAgentsRouter(deps.router));
  app.use("/api/history", createHistoryRouter(deps.store));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
