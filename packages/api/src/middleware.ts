import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import crypto from "node:crypto";

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
 * API key authentication middleware.
 * When DOJOPS_API_KEY is set, all /api/ routes (except /api/health) require
 * a matching Authorization: Bearer <key> or X-API-Key header.
 */
export function authMiddleware(apiKey?: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKey) {
      next();
      return;
    }

    // Health check is always public
    if (req.path === "/health" || req.path === "/api/health") {
      next();
      return;
    }

    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    const headerKey = req.headers["x-api-key"] as string | undefined;
    const provided = bearer ?? headerKey;

    if (!provided) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Constant-time comparison to prevent timing attacks
    const expected = Buffer.from(apiKey, "utf8");
    const actual = Buffer.from(provided, "utf8");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      res.status(403).json({ error: "Invalid API key" });
      return;
    }

    next();
  };
}

/**
 * Adds a unique X-Request-Id header to every request.
 * If the client provides one, it is preserved.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers["x-request-id"] as string) || crypto.randomUUID();
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
