import express, { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "path";
import { LLMProvider, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { HistoryStore } from "./store";
import { errorHandler, authMiddleware, requestIdMiddleware, requestLogger } from "./middleware";
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
  customToolCount?: number;
  customAgentNames?: Set<string>;
  corsOrigin?: string | string[];
  apiKey?: string;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();

  // Request ID (before all other middleware)
  app.use(requestIdMiddleware);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
        },
      },
    }),
  );

  // CORS: support env override via DOJOPS_CORS_ORIGIN (comma-separated origins)
  const corsOrigin =
    deps.corsOrigin ??
    (process.env.DOJOPS_CORS_ORIGIN
      ? process.env.DOJOPS_CORS_ORIGIN.split(",").map((s) => s.trim())
      : "http://localhost:3000");
  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "1mb" }));

  // Structured request logging
  app.use(requestLogger);

  // Rate limiting for API routes (A18: rate limiter before auth)
  const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.DOJOPS_RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000), 10),
    limit: parseInt(process.env.DOJOPS_RATE_LIMIT ?? "100", 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
  app.use("/api/", apiLimiter);

  // API key auth (reads from deps or env; health check is always public)
  const apiKey = deps.apiKey ?? process.env.DOJOPS_API_KEY;
  // When no API key is set, add warning header so clients/load-balancers can detect (A1)
  if (!apiKey) {
    app.use("/api/", (_req, _res, next) => {
      _res.setHeader("X-DojOps-Warning", "no-auth");
      next();
    });
  }
  app.use("/api/", authMiddleware(apiKey));

  // Serve static dashboard files
  app.use(express.static(deps.publicDir ?? path.join(__dirname, "..", "public")));

  // Metrics aggregator (enabled when rootDir is provided)
  const metricsEnabled = !!deps.rootDir;
  const aggregator = deps.rootDir ? new MetricsAggregator(deps.rootDir) : null;

  // Health check (public, no auth required) — A26: cache provider status with 60s TTL
  let cachedProviderStatus: "ok" | "degraded" = "ok";
  let lastProviderCheck = 0;
  const PROVIDER_CHECK_TTL = 60_000;
  const authRequired = !!apiKey;

  app.get("/api/health", async (req, res) => {
    if (deps.provider.listModels && Date.now() - lastProviderCheck > PROVIDER_CHECK_TTL) {
      try {
        await deps.provider.listModels();
        cachedProviderStatus = "ok";
      } catch {
        cachedProviderStatus = "degraded";
      }
      lastProviderCheck = Date.now();
    }

    const status = cachedProviderStatus === "ok" ? "ok" : "degraded";
    const timestamp = new Date().toISOString();

    // Check if caller is authenticated (for info-leak gating)
    let isAuthenticated = !authRequired;
    if (authRequired) {
      const bearer = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : undefined;
      const headerKey = req.headers["x-api-key"] as string | undefined;
      const provided = bearer ?? headerKey;
      if (provided && apiKey) {
        const expected = Buffer.from(apiKey, "utf8");
        const actual = Buffer.from(provided, "utf8");
        isAuthenticated =
          expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
      }
    }

    if (!isAuthenticated) {
      // Minimal payload for unauthenticated callers — no info leak
      res.json({ status, authRequired, timestamp });
      return;
    }

    res.json({
      status,
      authRequired,
      provider: deps.provider.name,
      providerStatus: cachedProviderStatus,
      tools: deps.tools.map((t) => t.name),
      customToolCount: deps.customToolCount ?? 0,
      metricsEnabled,
      memory: process.memoryUsage().heapUsed,
      uptime: process.uptime(),
      timestamp,
    });
  });

  // API routes
  app.use("/api/generate", createGenerateRouter(deps.router, deps.store));
  app.use("/api/plan", createPlanRouter(deps.provider, deps.tools, deps.store, apiKey));
  app.use("/api/debug-ci", createDebugCIRouter(deps.debugger, deps.store));
  app.use("/api/diff", createDiffRouter(deps.diffAnalyzer, deps.store));
  app.use("/api/agents", createAgentsRouter(deps.router, deps.customAgentNames));
  app.use("/api/history", createHistoryRouter(deps.store));
  app.use("/api/scan", createScanRouter(deps.store, deps.rootDir));
  app.use("/api/chat", createChatRouter(deps.provider, deps.router, deps.store, deps.rootDir));
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
