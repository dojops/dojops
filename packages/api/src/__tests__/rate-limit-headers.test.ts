import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Request, Response } from "express";
import request from "supertest";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { createRateLimiter, createApp, AppDependencies } from "../app";
import { HistoryStore } from "../store";

function mockReq(overrides?: Partial<Request>): Request {
  return {
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _headers: Record<string, string>; _status: number } {
  const headers: Record<string, string> = {};
  const res = {
    _headers: headers,
    _status: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    status(code: number) {
      res._status = code;
      return this;
    },
    json(body: unknown) {
      (res as Record<string, unknown>)._body = body;
      return this;
    },
  };
  return res as unknown as Response & { _headers: Record<string, string>; _status: number };
}

describe("createRateLimiter RFC headers (H-4)", () => {
  describe("headers on successful requests", () => {
    it("sets RateLimit-Limit on first request", () => {
      const limiter = createRateLimiter(60_000, 10);
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);

      expect(res._headers["RateLimit-Limit"]).toBe("10");
    });

    it("sets RateLimit-Remaining decremented each request", () => {
      const limiter = createRateLimiter(60_000, 10);
      const req = mockReq();
      const next = vi.fn();

      const res1 = mockRes();
      limiter(req, res1 as unknown as Response, next);
      expect(res1._headers["RateLimit-Remaining"]).toBe("9");

      const res2 = mockRes();
      limiter(req, res2 as unknown as Response, next);
      expect(res2._headers["RateLimit-Remaining"]).toBe("8");
    });

    it("sets RateLimit-Reset as epoch seconds", () => {
      const limiter = createRateLimiter(60_000, 10);
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);

      const resetValue = Number.parseInt(res._headers["RateLimit-Reset"], 10);
      expect(resetValue).toBeGreaterThan(0);
      // Should be roughly now + 60 seconds
      const nowSeconds = Math.ceil(Date.now() / 1000);
      expect(resetValue).toBeGreaterThanOrEqual(nowSeconds);
      expect(resetValue).toBeLessThanOrEqual(nowSeconds + 61);
    });

    it("RateLimit-Remaining never goes below 0", () => {
      const limiter = createRateLimiter(60_000, 2);
      const req = mockReq();
      const next = vi.fn();

      // 3 requests, max is 2
      for (let i = 0; i < 3; i++) {
        const res = mockRes();
        limiter(req, res as unknown as Response, next);
        const remaining = Number.parseInt(res._headers["RateLimit-Remaining"], 10);
        expect(remaining).toBeGreaterThanOrEqual(0);
      }
    });

    it("all three headers present on every response", () => {
      const limiter = createRateLimiter(60_000, 10);
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);

      expect(res._headers).toHaveProperty("RateLimit-Limit");
      expect(res._headers).toHaveProperty("RateLimit-Remaining");
      expect(res._headers).toHaveProperty("RateLimit-Reset");
    });
  });

  describe("rate limit enforcement", () => {
    it("returns 429 after exceeding maxRequests", () => {
      const limiter = createRateLimiter(60_000, 2);
      const req = mockReq();
      const next = vi.fn();

      // Requests 1 and 2 should succeed
      limiter(req, mockRes() as unknown as Response, next);
      limiter(req, mockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Request 3 should be blocked
      const res3 = mockRes();
      limiter(req, res3 as unknown as Response, next);
      expect(res3._status).toBe(429);
      expect(next).toHaveBeenCalledTimes(2); // no additional call
    });

    it("includes Retry-After header on 429", () => {
      const limiter = createRateLimiter(60_000, 1);
      const req = mockReq();
      const next = vi.fn();

      limiter(req, mockRes() as unknown as Response, next);

      const res2 = mockRes();
      limiter(req, res2 as unknown as Response, next);
      expect(res2._status).toBe(429);
      expect(res2._headers["Retry-After"]).toBeDefined();
      const retryAfter = Number.parseInt(res2._headers["Retry-After"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it("429 body contains error message", () => {
      const limiter = createRateLimiter(60_000, 1);
      const req = mockReq();
      const next = vi.fn();

      limiter(req, mockRes() as unknown as Response, next);

      const res2 = mockRes();
      limiter(req, res2 as unknown as Response, next);
      expect((res2 as unknown as Record<string, unknown>)._body).toEqual({
        error: "Too many requests, please try again later",
      });
    });

    it("calls next() for allowed requests", () => {
      const limiter = createRateLimiter(60_000, 5);
      const req = mockReq();
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("does not call next() for blocked requests", () => {
      const limiter = createRateLimiter(60_000, 1);
      const req = mockReq();
      const next = vi.fn();

      limiter(req, mockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);

      limiter(req, mockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1); // still 1
    });
  });

  describe("per-IP isolation", () => {
    it("tracks requests separately per IP", () => {
      const limiter = createRateLimiter(60_000, 2);
      const next = vi.fn();

      const req1 = mockReq({ ip: "10.0.0.1" });
      const req2 = mockReq({ ip: "10.0.0.2" });

      // 2 requests from IP1
      limiter(req1, mockRes() as unknown as Response, next);
      limiter(req1, mockRes() as unknown as Response, next);

      // IP1 is now at limit, but IP2 should still pass
      const res = mockRes();
      limiter(req2, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(res._headers["RateLimit-Remaining"]).toBe("1");
    });

    it("uses req.ip when available", () => {
      const limiter = createRateLimiter(60_000, 5);
      const req = mockReq({ ip: "192.168.1.100" });
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("falls back to socket.remoteAddress", () => {
      const limiter = createRateLimiter(60_000, 5);
      const req = mockReq({
        ip: undefined,
        socket: { remoteAddress: "10.0.0.5" },
      } as Partial<Request>);
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('uses "unknown" when both undefined', () => {
      const limiter = createRateLimiter(60_000, 5);
      const req = mockReq({
        ip: undefined,
        socket: { remoteAddress: undefined },
      } as Partial<Request>);
      const res = mockRes();
      const next = vi.fn();

      limiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("window reset", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resets count after window expires", () => {
      vi.setSystemTime(new Date("2026-02-28T10:00:00Z"));
      const limiter = createRateLimiter(60_000, 2);
      const req = mockReq();
      const next = vi.fn();

      // Use up the limit
      limiter(req, mockRes() as unknown as Response, next);
      limiter(req, mockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Third request should be blocked
      limiter(req, mockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(2);

      // Advance past the window
      vi.advanceTimersByTime(61_000);

      // Should be allowed again
      const res = mockRes();
      limiter(req, res as unknown as Response, next);
      expect(next).toHaveBeenCalledTimes(3);
      expect(res._headers["RateLimit-Remaining"]).toBe("1");
    });

    it("creates new entry on first request after expiry", () => {
      vi.setSystemTime(new Date("2026-02-28T10:00:00Z"));
      const limiter = createRateLimiter(10_000, 100);
      const req = mockReq();
      const next = vi.fn();

      limiter(req, mockRes() as unknown as Response, next);

      // Advance past the window
      vi.advanceTimersByTime(11_000);

      const res = mockRes();
      limiter(req, res as unknown as Response, next);
      // Fresh window — remaining should be maxRequests - 1
      expect(res._headers["RateLimit-Remaining"]).toBe("99");
    });
  });

  function createMockProvider(): LLMProvider {
    return {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: "Mock response",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } satisfies LLMResponse),
    };
  }

  function createMockTool(): DevOpsTool {
    return {
      name: "mock-tool",
      description: "A mock tool",
      inputSchema: { safeParse: () => ({ success: true, data: {} }) } as never,
      validate: () => ({ valid: true }),
      generate: vi.fn().mockResolvedValue({ success: true, data: { yaml: "test: true" } }),
    };
  }

  function createTestDeps(): AppDependencies {
    const provider = createMockProvider();
    return {
      provider,
      tools: [createMockTool()],
      router: new AgentRouter(provider),
      debugger: new CIDebugger(provider),
      diffAnalyzer: new InfraDiffAnalyzer(provider),
      store: new HistoryStore(),
    };
  }

  describe("integration: per-route limits (E-6)", () => {
    it("POST /api/generate has RateLimit headers", async () => {
      const deps = createTestDeps();
      const app = createApp(deps);

      const res = await request(app).post("/api/generate").send({ prompt: "Create a Dockerfile" });

      // Should have the per-route rate limit headers from our custom limiter
      expect(res.headers["ratelimit-limit"]).toBeDefined();
      expect(res.headers["ratelimit-remaining"]).toBeDefined();
      expect(res.headers["ratelimit-reset"]).toBeDefined();
    });

    it("POST /api/scan has RateLimit headers", async () => {
      const deps = createTestDeps();
      deps.rootDir = "/tmp/nonexistent-test-dir";
      const app = createApp(deps);

      const res = await request(app).post("/api/scan").send({ target: "/tmp/test" });

      // Should have rate limit headers even if scan fails
      expect(res.headers["ratelimit-limit"]).toBeDefined();
      expect(res.headers["ratelimit-remaining"]).toBeDefined();
    });
  });
});
