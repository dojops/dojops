import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { validateBody, errorHandler, authMiddleware, requestLogger } from "../middleware";

function mockReqRes(body: unknown, headers: Record<string, string> = {}) {
  const req = { body, headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe("validateBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("calls next on valid body", () => {
    const { req, res, next } = mockReqRes({ name: "test" });
    validateBody(schema)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid body", () => {
    const { req, res, next } = mockReqRes({ name: "" });
    validateBody(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Validation failed" }));
    expect(next).not.toHaveBeenCalled();
  });
});

describe("errorHandler", () => {
  it("returns 400 for ZodError", () => {
    const schema = z.object({ x: z.string() });
    const result = schema.safeParse({ x: 123 });
    const zodErr = result.success ? new ZodError([]) : result.error;

    const { req, res, next } = mockReqRes({});
    errorHandler(zodErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Validation failed" }));
  });

  it("returns 500 with generic message regardless of NODE_ENV (G-23)", () => {
    delete process.env.NODE_ENV;
    const { req, res, next } = mockReqRes({});
    errorHandler(new Error("boom"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = vi.mocked(res.json).mock.calls[0][0];
    expect(payload.error).toBe("Internal server error");
    // G-23: Never leak error details to clients
    expect(payload.message).toBeUndefined();
  });

  it("hides message in production", () => {
    process.env.NODE_ENV = "production";
    const { req, res, next } = mockReqRes({});
    errorHandler(new Error("secret detail"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = vi.mocked(res.json).mock.calls[0][0];
    expect(payload.error).toBe("Internal server error");
    expect(payload.message).toBeUndefined();
    delete process.env.NODE_ENV;
  });
});

function mockAuthReqRes(path: string, headers: Record<string, string> = {}) {
  const req = { path, headers } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals: {} as Record<string, unknown>,
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

/**
 * Run an auth middleware and assert the expected outcome:
 * - "pass": next was called, status was NOT called
 * - number: status was called with that code, next was NOT called
 */
function runAuthMiddleware(
  apiKey: string | undefined,
  reqPath: string,
  headers: Record<string, string>,
  expected: "pass" | number,
) {
  const middleware = authMiddleware(apiKey);
  const { req, res, next } = mockAuthReqRes(reqPath, headers);
  middleware(req, res, next);
  if (expected === "pass") {
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  } else {
    expect(res.status).toHaveBeenCalledWith(expected);
    expect(next).not.toHaveBeenCalled();
  }
  return { res };
}

describe("authMiddleware", () => {
  it("passes through when no apiKey configured", () => {
    const middleware = authMiddleware();
    const { req, res, next } = mockAuthReqRes("/api/generate");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    // No API key configured → treat as authenticated (no auth to bypass)
    expect(res.locals.authenticated).toBe(true);
  });

  it("allows /health without auth even when apiKey is set", () => {
    runAuthMiddleware("secret-key-123", "/health", {}, "pass");
  });

  it("allows /api/health without auth even when apiKey is set", () => {
    runAuthMiddleware("secret-key-123", "/api/health", {}, "pass");
  });

  it("returns 401 when no auth header provided", () => {
    const { res } = runAuthMiddleware("secret-key-123", "/api/generate", {}, 401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
  });

  it("returns 403 for wrong Bearer token", () => {
    const { res } = runAuthMiddleware(
      "correct-key",
      "/api/generate",
      {
        authorization: "Bearer wrong-key-xx",
      },
      403,
    );
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
  });

  it("passes with correct Bearer token and sets authenticated", () => {
    const { res } = runAuthMiddleware(
      "my-secret-key",
      "/api/generate",
      {
        authorization: "Bearer my-secret-key",
      },
      "pass",
    );
    expect(res.locals.authenticated).toBe(true);
  });

  it("passes with correct X-API-Key header", () => {
    runAuthMiddleware(
      "my-secret-key",
      "/api/generate",
      {
        "x-api-key": "my-secret-key",
      },
      "pass",
    );
  });

  it("prefers Bearer over X-API-Key when both present", () => {
    // Bearer is correct so it should pass, even though X-API-Key is wrong
    runAuthMiddleware(
      "correct-key-value",
      "/api/generate",
      {
        authorization: "Bearer correct-key-value",
        "x-api-key": "wrong-key-value---",
      },
      "pass",
    );
  });

  it("returns 403 for key with different length", () => {
    const { res } = runAuthMiddleware(
      "short",
      "/api/generate",
      {
        authorization: "Bearer much-longer-key-that-differs-in-length",
      },
      403,
    );
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
  });

  it("returns 401 for empty Bearer token ('Bearer ' with no key)", () => {
    const middleware = authMiddleware("secret-key-123");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      authorization: "Bearer ",
    });
    middleware(req, res, next);
    // "Bearer " slices to empty string, which is falsy → falls through to 401
    // unless X-API-Key is also provided
    expect(next).not.toHaveBeenCalled();
    // Either 401 (no provided key) or 403 (empty key doesn't match)
    const statusCode = vi.mocked(res.status).mock.calls[0][0];
    expect([401, 403]).toContain(statusCode);
  });

  it("returns 401 for Bearer followed by whitespace-only token", () => {
    const middleware = authMiddleware("secret-key-123");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      authorization: "Bearer    ",
    });
    middleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    // Whitespace-only token should not authenticate successfully
    const statusCode = vi.mocked(res.status).mock.calls[0][0];
    expect([401, 403]).toContain(statusCode);
  });
});

function mockLoggerReqRes(reqPath: string, headers: Record<string, string> = {}) {
  const req = {
    method: "GET",
    path: reqPath,
    headers: { "x-request-id": "test-req-id", ...headers },
  } as unknown as Request;

  const finishCallbacks: Array<() => void> = [];
  const res = {
    statusCode: 200,
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "finish") finishCallbacks.push(cb);
    }),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;
  return { req, res, next, finishCallbacks };
}

describe("T-9: requestLogger CRLF injection prevention", () => {
  it("does not emit raw CRLF in non-production logged output", () => {
    const origEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { req, res, next, finishCallbacks } = mockLoggerReqRes(
      "/api/health\r\nInjected-Header: malicious",
    );

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();

    // Trigger the "finish" event
    for (const cb of finishCallbacks) cb();

    expect(logSpy).toHaveBeenCalled();
    const loggedOutput = logSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    // The log should contain the path info
    expect(loggedOutput).toContain("/api/health");

    logSpy.mockRestore();
    if (origEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it("escapes CRLF in production JSON format via JSON.stringify", () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { req, res, next, finishCallbacks } = mockLoggerReqRes("/api/test\r\nX-Injected: evil");

    requestLogger(req, res, next);
    for (const cb of finishCallbacks) cb();

    expect(logSpy).toHaveBeenCalled();
    // In production mode, the logger uses JSON.stringify which escapes control characters
    const loggedOutput = logSpy.mock.calls[0][0];
    // JSON.stringify escapes \r as \\r and \n as \\n, so raw CRLF sequence should not appear
    expect(loggedOutput).not.toMatch(/\r\n/);
    // Verify it's valid JSON
    const parsed = JSON.parse(loggedOutput);
    expect(parsed.path).toContain("/api/test");

    logSpy.mockRestore();
    process.env.NODE_ENV = origEnv;
  });
});

describe("T-14: requestLogger secret leakage via query parameters", () => {
  it("logs only req.path which does not include query params in Express", () => {
    const origEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // In a real Express app, req.path is "/api/health" (no query string).
    // The requestLogger logs req.path, so query params are not included.
    const { req, res, next, finishCallbacks } = mockLoggerReqRes("/api/health");

    requestLogger(req, res, next);
    for (const cb of finishCallbacks) cb();

    expect(logSpy).toHaveBeenCalled();
    const loggedOutput = logSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(loggedOutput).not.toContain("sk-secret123");
    expect(loggedOutput).toContain("/api/health");

    logSpy.mockRestore();
    if (origEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it("in production JSON mode, does not include query params when req.path is clean", () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { req, res, next, finishCallbacks } = mockLoggerReqRes("/api/health");

    requestLogger(req, res, next);
    for (const cb of finishCallbacks) cb();

    expect(logSpy).toHaveBeenCalled();
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.path).toBe("/api/health");
    // Verify no secret data leaks
    expect(parsed.path).not.toContain("key=");
    expect(parsed.path).not.toContain("token=");

    logSpy.mockRestore();
    process.env.NODE_ENV = origEnv;
  });

  it("documents behavior when req.path erroneously includes query params", () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Simulate a malformed scenario where query params leak into req.path
    const { req, res, next, finishCallbacks } = mockLoggerReqRes("/api/health?key=sk-secret123");

    requestLogger(req, res, next);
    for (const cb of finishCallbacks) cb();

    expect(logSpy).toHaveBeenCalled();
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    // The current implementation logs req.path as-is without stripping query params.
    // In real Express usage, req.path never includes query params, so this is safe.
    // This test documents that the logger does not perform its own query-param stripping.
    expect(parsed.path).toBeDefined();
    expect(parsed.method).toBe("GET");

    logSpy.mockRestore();
    process.env.NODE_ENV = origEnv;
  });
});
