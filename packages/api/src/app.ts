import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
  pluginCount?: number;
  customAgentNames?: Set<string>;
  corsOrigin?: string | string[];
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
        },
      },
    }),
  );
  app.use(cors({ origin: deps.corsOrigin ?? "http://localhost:3000" }));
  app.use(express.json({ limit: "1mb" }));

  // Rate limiting for API routes
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // 100 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
  app.use("/api/", apiLimiter);

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
      pluginCount: deps.pluginCount ?? 0,
      metricsEnabled,
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  app.use("/api/generate", createGenerateRouter(deps.router, deps.store));
  app.use("/api/plan", createPlanRouter(deps.provider, deps.tools, deps.store));
  app.use("/api/debug-ci", createDebugCIRouter(deps.debugger, deps.store));
  app.use("/api/diff", createDiffRouter(deps.diffAnalyzer, deps.store));
  app.use("/api/agents", createAgentsRouter(deps.router, deps.customAgentNames));
  app.use("/api/history", createHistoryRouter(deps.store));
  app.use("/api/scan", createScanRouter(deps.store, deps.rootDir));
  app.use("/api/chat", createChatRouter(deps.provider, deps.router, deps.store));
  if (aggregator) {
    app.use("/api/metrics", createMetricsRouter(aggregator));
  } else {
    app.use("/api/metrics", (_req: express.Request, res: express.Response) => {
      res.status(404).json({ error: "Metrics not available: no project root configured" });
    });
  }

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
