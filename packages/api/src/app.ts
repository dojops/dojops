import express, { Express } from "express";
import cors from "cors";
import path from "path";
import { LLMProvider, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { HistoryStore } from "./store";
import { errorHandler } from "./middleware";
import {
  createGenerateRouter,
  createPlanRouter,
  createDebugCIRouter,
  createDiffRouter,
  createAgentsRouter,
  createHistoryRouter,
  createScanRouter,
  createChatRouter,
  createMetricsRouter,
} from "./routes";
import { MetricsAggregator } from "./metrics";

export interface AppDependencies {
  provider: LLMProvider;
  tools: DevOpsTool[];
  router: AgentRouter;
  debugger: CIDebugger;
  diffAnalyzer: InfraDiffAnalyzer;
  store: HistoryStore;
  publicDir?: string;
  rootDir?: string;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  // Serve static dashboard files
  app.use(express.static(deps.publicDir ?? path.join(__dirname, "..", "public")));

  // Metrics aggregator (enabled when rootDir is provided)
  const metricsEnabled = !!deps.rootDir;
  const aggregator = deps.rootDir ? new MetricsAggregator(deps.rootDir) : null;

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      provider: deps.provider.name,
      tools: deps.tools.map((t) => t.name),
      metricsEnabled,
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
  app.use("/api/scan", createScanRouter(deps.store));
  app.use("/api/chat", createChatRouter(deps.provider, deps.router, deps.store));
  if (aggregator) {
    app.use("/api/metrics", createMetricsRouter(aggregator));
  }

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
