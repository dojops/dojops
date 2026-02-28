import { describe, it, expect, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";
import { validateBody, errorHandler, authMiddleware } from "./middleware";

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
    const zodErr = !result.success ? result.error : new ZodError([]);

    const { req, res, next } = mockReqRes({});
    errorHandler(zodErr, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Validation failed" }));
  });

  it("returns 500 with message in development", () => {
    delete process.env.NODE_ENV;
    const { req, res, next } = mockReqRes({});
    errorHandler(new Error("boom"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Internal server error", message: "boom" }),
    );
  });

  it("hides message in production", () => {
    process.env.NODE_ENV = "production";
    const { req, res, next } = mockReqRes({});
    errorHandler(new Error("secret detail"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
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

describe("authMiddleware", () => {
  it("passes through when no apiKey configured", () => {
    const middleware = authMiddleware(undefined);
    const { req, res, next } = mockAuthReqRes("/api/generate");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    // No API key configured → not authenticated
    expect(res.locals.authenticated).toBe(false);
  });

  it("allows /health without auth even when apiKey is set", () => {
    const middleware = authMiddleware("secret-key-123");
    const { req, res, next } = mockAuthReqRes("/health");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows /api/health without auth even when apiKey is set", () => {
    const middleware = authMiddleware("secret-key-123");
    const { req, res, next } = mockAuthReqRes("/api/health");
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when no auth header provided", () => {
    const middleware = authMiddleware("secret-key-123");
    const { req, res, next } = mockAuthReqRes("/api/generate");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for wrong Bearer token", () => {
    const middleware = authMiddleware("correct-key");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      authorization: "Bearer wrong-key-xx",
    });
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes with correct Bearer token and sets authenticated", () => {
    const middleware = authMiddleware("my-secret-key");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      authorization: "Bearer my-secret-key",
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(res.locals.authenticated).toBe(true);
  });

  it("passes with correct X-API-Key header", () => {
    const middleware = authMiddleware("my-secret-key");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      "x-api-key": "my-secret-key",
    });
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("prefers Bearer over X-API-Key when both present", () => {
    const middleware = authMiddleware("correct-key-value");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      authorization: "Bearer correct-key-value",
      "x-api-key": "wrong-key-value---",
    });
    middleware(req, res, next);
    // Bearer is correct so it should pass, even though X-API-Key is wrong
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 for key with different length", () => {
    const middleware = authMiddleware("short");
    const { req, res, next } = mockAuthReqRes("/api/generate", {
      authorization: "Bearer much-longer-key-that-differs-in-length",
    });
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid API key" });
    expect(next).not.toHaveBeenCalled();
  });
});
