import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { LLMProvider, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsSkill } from "@dojops/sdk";
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
  createReviewRouter,
  createAutoRouter,
} from "./routes";
import { MetricsAggregator } from "./metrics";
import { TokenTracker } from "./token-tracker";

export interface AppDependencies {
  provider: LLMProvider;
  tools: DevOpsSkill[];
  router: AgentRouter;
  debugger: CIDebugger;
  diffAnalyzer: InfraDiffAnalyzer;
  store: HistoryStore;
  publicDir?: string;
  rootDir?: string;
  customToolCount?: number;
  customAgentNames?: Set<string>;
  corsOrigin?: string | string[];
  apiKey?: string | string[];
  /** Optional documentation augmenter (Context7) for injecting up-to-date docs */
  docAugmenter?: { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };
  /** Optional Context7 DocProvider for v2 .dops skills */
  context7Provider?: {
    resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
    queryDocs(libraryId: string, query: string): Promise<string>;
  };
  /** Optional project context string for v2 .dops skills */
  projectContext?: string;
}

/**
 * In-memory per-route rate limiter factory.
 * Uses Map<string, { count, resetAt }> keyed by IP.
 */
export function createRateLimiter(windowMs: number, maxRequests: number) {
  const clients = new Map<string, { count: number; resetAt: number }>();

  // Periodic cleanup of expired entries (every windowMs)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clients) {
      if (now >= entry.resetAt) {
        clients.delete(key);
      }
    }
  }, windowMs);
  // Allow the process to exit without waiting for the interval
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let entry = clients.get(ip);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      clients.set(ip, entry);
    }

    entry.count++;

    // RFC 6585 / draft-ietf-httpapi-ratelimit-headers: set on every response
    res.setHeader("RateLimit-Limit", String(maxRequests));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, maxRequests - entry.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "Too many requests, please try again later" });
      return;
    }

    next();
  };
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
  app.use(cors({ origin: corsOrigin })); // NOSONAR — S5247: explicit allow-list origin, not wildcard
  app.use(express.json({ limit: "1mb" }));

  // Structured request logging
  app.use(requestLogger);

  // Rate limiting for API routes (A18: rate limiter before auth)
  const apiLimiter = rateLimit({
    windowMs: Number.parseInt(
      process.env.DOJOPS_RATE_LIMIT_WINDOW_MS ?? String(15 * 60 * 1000),
      10,
    ),
    limit: Number.parseInt(process.env.DOJOPS_RATE_LIMIT ?? "100", 10),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later" },
  });
  app.use("/api/", apiLimiter);
  app.use("/api/v1/", apiLimiter);

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
  app.use("/api/v1/", authMiddleware(apiKey));

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

  /** Check if the caller is authenticated via API key. */
  function isCallerAuthenticated(req: Request): boolean {
    if (!authRequired) return true;
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const headerKey = req.headers["x-api-key"] as string | undefined;
    const provided = bearer ?? headerKey;
    if (!provided || !apiKey) return false;

    const keys = Array.isArray(apiKey) ? apiKey : [apiKey];
    for (const key of keys) {
      const expected = Buffer.from(key, "utf8");
      const actual = Buffer.from(provided, "utf8");
      if (expected.length === actual.length && crypto.timingSafeEqual(expected, actual)) {
        return true;
      }
    }
    return false;
  }

  const healthHandler = async (req: Request, res: Response) => {
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

    if (!isCallerAuthenticated(req)) {
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
  };

  // BUG #4: Register version middleware BEFORE health routes so /api/v1/health gets X-API-Version header
  const versionMiddleware = (_req: express.Request, res: express.Response, next: NextFunction) => {
    res.setHeader("X-API-Version", "1");
    next();
  };
  app.use("/api/v1/", versionMiddleware);

  // Mount health at both /api/ and /api/v1/ paths
  app.get("/api/health", healthHandler);
  app.get("/api/v1/health", healthHandler);

  // Per-route rate limiters (E-6) — more restrictive limits for expensive endpoints
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const llmLimiter = createRateLimiter(FIFTEEN_MIN, 20); // generate, chat, diff, debug-ci
  const planLimiter = createRateLimiter(FIFTEEN_MIN, 10); // most expensive
  const scanLimiter = createRateLimiter(FIFTEEN_MIN, 5); // scanner invocations

  // Create route handler instances once (shared between /api/ and /api/v1/)
  const generateRouter = createGenerateRouter(
    deps.router,
    deps.store,
    deps.provider,
    deps.rootDir,
    deps.context7Provider,
  );
  // Build agent configs map from the AgentRouter for plan-time agent delegation
  const agentConfigs = new Map<
    string,
    { name: string; domain: string; description?: string; systemPrompt: string }
  >();
  for (const agent of deps.router.getAgents()) {
    agentConfigs.set(agent.name, {
      name: agent.name,
      domain: agent.domain,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
    });
  }

  const planRouter = createPlanRouter(deps.provider, deps.tools, deps.store, agentConfigs);
  const debugCIRouter = createDebugCIRouter(deps.debugger, deps.store);
  const diffRouter = createDiffRouter(deps.diffAnalyzer, deps.store);
  const agentsRouter = createAgentsRouter(deps.router, deps.customAgentNames);
  const historyRouter = createHistoryRouter(deps.store);
  const scanRouter = createScanRouter(deps.store, deps.rootDir);
  const chatRouter = createChatRouter(deps.provider, deps.router, deps.store, deps.rootDir);
  const reviewRouter = createReviewRouter(
    deps.provider,
    deps.store,
    deps.rootDir,
    deps.context7Provider,
  );
  const autoRouter = createAutoRouter(deps.provider, deps.tools, deps.store, deps.rootDir);

  // Mount routes at both /api/ (backward compat) and /api/v1/ (versioned)
  const mountRoutes = (prefix: string) => {
    app.use(`${prefix}/generate`, llmLimiter, generateRouter);
    app.use(`${prefix}/plan`, planLimiter, planRouter);
    app.use(`${prefix}/debug-ci`, llmLimiter, debugCIRouter);
    app.use(`${prefix}/diff`, llmLimiter, diffRouter);
    app.use(`${prefix}/agents`, agentsRouter);
    app.use(`${prefix}/history`, historyRouter);
    app.use(`${prefix}/scan`, scanLimiter, scanRouter);
    app.use(`${prefix}/chat`, llmLimiter, chatRouter);
    app.use(`${prefix}/review`, llmLimiter, reviewRouter);
    app.use(`${prefix}/auto`, planLimiter, autoRouter);
  };

  // #27: API versioning — /api/v1/ is the canonical prefix (middleware registered above health routes)
  mountRoutes("/api/v1");
  mountRoutes("/api");

  // Token budget tracker (E-7)
  const tokenTracker = new TokenTracker();

  /** Extract token count from a history entry for tracking. */
  function extractTokenCount(entry: Parameters<typeof deps.store.add>[0]): number {
    const rec = entry as Record<string, unknown>;
    if (rec.tokens && typeof rec.tokens === "object") {
      const tokens = rec.tokens as Record<string, unknown>;
      return typeof tokens.total === "number" ? tokens.total : 0;
    }
    if (!entry.response || typeof entry.response !== "object") return 0;
    const resp = entry.response as Record<string, unknown>;
    if (typeof resp.totalTokens === "number") return resp.totalTokens;
    if (typeof resp.usage === "object" && resp.usage !== null) {
      const usage = resp.usage as Record<string, unknown>;
      if (typeof usage.totalTokens === "number") return usage.totalTokens;
      if (typeof usage.total_tokens === "number") return usage.total_tokens;
    }
    return 0;
  }

  // Hook token tracking into history store additions
  const originalAdd = deps.store.add.bind(deps.store);
  deps.store.add = (entry) => {
    const result = originalAdd(entry);
    const total = extractTokenCount(entry);
    if (total > 0) tokenTracker.record(total);
    return result;
  };

  // Token metrics endpoint (E-7) — must be registered before the catch-all /api/metrics router
  const tokenHandler = (_req: express.Request, res: express.Response) => {
    res.json(tokenTracker.getSummary());
  };
  app.get("/api/metrics/tokens", tokenHandler);
  app.get("/api/v1/metrics/tokens", tokenHandler);

  const metricsRouter = aggregator
    ? createMetricsRouter(aggregator)
    : (_req: express.Request, res: express.Response) => {
        res.status(404).json({ error: "Metrics not available: no project root configured" });
      };
  app.use("/api/metrics", metricsRouter);
  app.use("/api/v1/metrics", metricsRouter);

  // 404 handler for unmatched API routes (returns JSON instead of Express HTML default)
  app.use("/api", (_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
