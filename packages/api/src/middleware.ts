import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import crypto from "node:crypto";

// ── E-2: Brute-force protection ─────────────────────────────────

const BRUTE_FORCE_MAX_FAILURES = 5;
const BRUTE_FORCE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

interface FailureRecord {
  count: number;
  firstAttempt: number;
}

const failureTracker = new Map<string, FailureRecord>();

// Periodic cleanup every 5 minutes to prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of failureTracker) {
      if (now - record.firstAttempt > BRUTE_FORCE_WINDOW_MS) {
        failureTracker.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

/**
 * Check if an IP is currently blocked due to too many auth failures.
 * Returns true if the request should be blocked (429).
 */
export function isIpBlocked(ip: string): boolean {
  const record = failureTracker.get(ip);
  if (!record) return false;
  const now = Date.now();
  if (now - record.firstAttempt > BRUTE_FORCE_WINDOW_MS) {
    failureTracker.delete(ip);
    return false;
  }
  return record.count >= BRUTE_FORCE_MAX_FAILURES;
}

/**
 * Record an auth failure for the given IP address.
 */
export function recordAuthFailure(ip: string): void {
  startCleanupTimer();
  const now = Date.now();
  const existing = failureTracker.get(ip);
  if (existing && now - existing.firstAttempt < BRUTE_FORCE_WINDOW_MS) {
    existing.count++;
  } else {
    failureTracker.set(ip, { count: 1, firstAttempt: now });
  }
}

/**
 * Reset the failure tracker (useful for testing).
 */
export function resetFailureTracker(): void {
  failureTracker.clear();
}

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Timing-safe comparison of a provided key against one expected key.
 */
function timingSafeCompare(expected: string, actual: string): boolean {
  // Hash both to equalize lengths before comparing — prevents length-based timing oracle
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  return crypto.timingSafeEqual(expectedHash, actualHash);
}

/**
 * Check if a provided key matches any of the configured API keys (E-3: key rotation).
 * Performs timing-safe comparison against each key.
 */
function matchesAnyKey(keys: string[], provided: string): boolean {
  let matched = false;
  for (const key of keys) {
    if (timingSafeCompare(key, provided)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * API key authentication middleware.
 * When DOJOPS_API_KEY is set, all /api/ routes (except /api/health) require
 * a matching Authorization: Bearer <key> or X-API-Key header.
 *
 * E-2: Includes brute-force protection — blocks IPs after 5 failures within 15 minutes.
 * E-3: Supports single key (string) or multiple keys (string[]) for key rotation.
 */
export function authMiddleware(apiKey?: string | string[]) {
  let keys: string[];
  if (!apiKey) keys = [];
  else if (Array.isArray(apiKey)) keys = apiKey;
  else keys = [apiKey];

  return (req: Request, res: Response, next: NextFunction): void => {
    // Track authentication state on res.locals for downstream route handlers
    res.locals.authenticated = false;

    if (keys.length === 0) {
      // No server-side auth configured — treat as authenticated (no auth barrier to enforce)
      res.locals.authenticated = true;
      next();
      return;
    }

    // Health check is always public (supports /api/health and /api/v1/health)
    if (req.path === "/health" || req.path === "/api/health" || req.path === "/v1/health") {
      next();
      return;
    }

    // E-2: Check brute-force block before processing
    const clientIp = req.ip ?? "unknown";
    if (isIpBlocked(clientIp)) {
      res.status(429).json({ error: "Too many authentication failures. Try again later." });
      return;
    }

    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const headerKey = req.headers["x-api-key"] as string | undefined;
    const provided = bearer ?? headerKey;

    if (!provided) {
      recordAuthFailure(clientIp);
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // E-3: Timing-safe comparison against each configured key
    if (!matchesAnyKey(keys, provided)) {
      recordAuthFailure(clientIp);
      res.status(403).json({ error: "Invalid API key" });
      return;
    }

    res.locals.authenticated = true;
    next();
  };
}

const VALID_REQUEST_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Adds a unique X-Request-Id header to every request.
 * If the client provides a valid one, it is preserved; otherwise a fresh UUID is generated.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const clientId = req.headers["x-request-id"] as string | undefined;
  const id = clientId && VALID_REQUEST_ID.test(clientId) ? clientId : crypto.randomUUID();
  req.headers["x-request-id"] = id;
  res.setHeader("X-Request-Id", id);
  next();
}

/**
 * Structured request logging middleware.
 * Logs method, path, status, and duration in JSON format.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const entry = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      requestId: req.headers["x-request-id"],
    };
    // Use structured JSON in production, readable format otherwise
    if (process.env.NODE_ENV === "production") {
      console.log(JSON.stringify(entry));
    } else {
      console.log(`[API] ${entry.method} ${entry.path} ${entry.status} ${entry.durationMs}ms`);
    }
  });
  next();
}

// Express error handlers must have 4 parameters
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const requestId = _req.headers["x-request-id"] as string | undefined;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      ...(requestId ? { requestId } : {}),
      details: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  console.error("[API]", err);
  const isProduction = process.env.NODE_ENV === "production";
  res.status(500).json({
    error: "Internal server error",
    ...(requestId ? { requestId } : {}),
    ...(isProduction ? {} : { message: err.message }),
  });
}
