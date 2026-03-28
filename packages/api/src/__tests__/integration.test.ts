import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp, AppDependencies } from "../app";
import { resetFailureTracker } from "../middleware";
import { createTestDeps } from "./test-helpers";

/**
 * Integration tests that exercise full request-to-response workflows
 * through the Express app, covering multi-step operations and cross-cutting concerns.
 */

function createMockDeps(): AppDependencies {
  return createTestDeps();
}

describe("API integration", () => {
  let deps: AppDependencies;

  beforeEach(() => {
    deps = createMockDeps();
    resetFailureTracker();
  });

  describe("history tracking across operations", () => {
    it("tracks generate operation in history", async () => {
      const app = createApp(deps);

      await request(app).post("/api/generate").send({ prompt: "test prompt" }).expect(200);

      const historyRes = await request(app).get("/api/history").expect(200);
      expect(historyRes.body.entries).toHaveLength(1);
      expect(historyRes.body.entries[0].type).toBe("generate");
    });

    it("tracks multiple operations in order", async () => {
      const app = createApp(deps);

      await request(app).post("/api/generate").send({ prompt: "first" });
      await request(app).post("/api/generate").send({ prompt: "second" });

      const historyRes = await request(app).get("/api/history").expect(200);
      expect(historyRes.body.entries).toHaveLength(2);
    });

    it("clears history on DELETE", async () => {
      const app = createApp(deps);

      await request(app).post("/api/generate").send({ prompt: "test" });
      await request(app).delete("/api/history").set("X-Confirm", "clear").expect(200);

      const historyRes = await request(app).get("/api/history").expect(200);
      expect(historyRes.body.entries).toHaveLength(0);
    });

    it("retrieves single history entry by id", async () => {
      const app = createApp(deps);

      await request(app).post("/api/generate").send({ prompt: "test" });

      const allHistory = await request(app).get("/api/history").expect(200);
      const id = allHistory.body.entries[0].id;
      expect(id).toMatch(/^[a-f0-9]{12}$/);

      const single = await request(app).get(`/api/history/${id}`).expect(200);
      expect(single.body.id).toBe(id);
    });

    it("returns 404 for unknown history id", async () => {
      const app = createApp(deps);
      await request(app).get("/api/history/nonexistent").expect(404);
    });
  });

  describe("request validation", () => {
    it.each([
      ["/api/generate", "generate with empty body"],
      ["/api/plan", "plan with missing goal"],
      ["/api/debug-ci", "debug-ci with missing log"],
      ["/api/diff", "diff with missing diff"],
    ] as const)("rejects %s", async (endpoint) => {
      const app = createApp(deps);
      await request(app).post(endpoint).send({}).expect(400);
    });
  });

  describe("health endpoint", () => {
    it("returns provider info and tool list", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/health").expect(200);

      expect(res.body.status).toBe("ok");
      expect(res.body.authRequired).toBe(false);
      expect(res.body.provider).toBe("mock");
      expect(res.body.tools).toContain("mock-tool");
      expect(res.body.timestamp).toBeDefined();
    });

    it("returns minimal payload when auth enabled and no key provided", async () => {
      const authDeps = createMockDeps();
      authDeps.apiKey = "secret-key-123";
      const app = createApp(authDeps);

      const res = await request(app).get("/api/health").expect(200);
      expect(res.body.authRequired).toBe(true);
      expect(res.body.status).toBe("ok");
      expect(res.body.provider).toBeUndefined();
      expect(res.body.tools).toBeUndefined();
    });

    it("returns full payload when auth enabled and valid key provided", async () => {
      const authDeps = createMockDeps();
      authDeps.apiKey = "secret-key-123";
      const app = createApp(authDeps);

      const res = await request(app)
        .get("/api/health")
        .set("X-API-Key", "secret-key-123")
        .expect(200);
      expect(res.body.authRequired).toBe(true);
      expect(res.body.provider).toBe("mock");
      expect(res.body.tools).toContain("mock-tool");
    });
  });

  describe("agents endpoint", () => {
    it("lists all specialist agents", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/agents").expect(200);

      expect(Array.isArray(res.body.agents)).toBe(true);
      expect(res.body.agents.length).toBeGreaterThan(0);
      expect(res.body.agents[0]).toHaveProperty("name");
      expect(res.body.agents[0]).toHaveProperty("domain");
      expect(res.body.agents[0]).toHaveProperty("description");
    });
  });

  describe("CORS headers", () => {
    it("includes CORS headers when Origin matches", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/health").set("Origin", "http://localhost:3000");
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    });

    it("uses custom corsOrigin when provided", async () => {
      const customDeps = createMockDeps();
      customDeps.corsOrigin = "https://example.com";
      const app = createApp(customDeps);
      const res = await request(app).get("/api/health").set("Origin", "https://example.com");
      expect(res.headers["access-control-allow-origin"]).toBe("https://example.com");
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding rate limit", async () => {
      // Save original env values
      const origLimit = process.env.DOJOPS_RATE_LIMIT;
      const origWindow = process.env.DOJOPS_RATE_LIMIT_WINDOW_MS;

      // Set very low rate limit — must be set BEFORE createApp reads them
      process.env.DOJOPS_RATE_LIMIT = "3";
      process.env.DOJOPS_RATE_LIMIT_WINDOW_MS = "60000";

      const limitedApp = createApp(createMockDeps());

      // Send requests up to the limit
      for (let i = 0; i < 3; i++) {
        await request(limitedApp).get("/api/health").expect(200);
      }

      // Next request should be rate limited
      const res = await request(limitedApp).get("/api/health");
      expect(res.status).toBe(429);

      // Cleanup
      if (origLimit === undefined) delete process.env.DOJOPS_RATE_LIMIT;
      else process.env.DOJOPS_RATE_LIMIT = origLimit;
      if (origWindow === undefined) delete process.env.DOJOPS_RATE_LIMIT_WINDOW_MS;
      else process.env.DOJOPS_RATE_LIMIT_WINDOW_MS = origWindow;
    });
  });

  describe("health check details", () => {
    it("returns detailed health response shape", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/health").expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          status: "ok",
          authRequired: false,
          provider: "mock",
          providerStatus: "ok",
          tools: ["mock-tool"],
          customToolCount: 0,
          metricsEnabled: false,
        }),
      );
      // L-1: memory and uptime are gated behind DOJOPS_DEBUG
      expect(res.body.memory).toBeUndefined();
      expect(res.body.uptime).toBeUndefined();
      expect(typeof res.body.timestamp).toBe("string");
      // Timestamp should be a valid ISO date
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it("includes memory and uptime when DOJOPS_DEBUG is enabled", async () => {
      const origDebug = process.env.DOJOPS_DEBUG;
      process.env.DOJOPS_DEBUG = "true";
      try {
        const app = createApp(deps);
        const res = await request(app).get("/api/health").expect(200);
        expect(typeof res.body.memory).toBe("number");
        expect(res.body.memory).toBeGreaterThan(0);
        expect(typeof res.body.uptime).toBe("number");
        expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      } finally {
        if (origDebug === undefined) delete process.env.DOJOPS_DEBUG;
        else process.env.DOJOPS_DEBUG = origDebug;
      }
    });

    it("shows degraded when listModels fails", async () => {
      const degradedDeps = createMockDeps();
      degradedDeps.provider.listModels = vi
        .fn()
        .mockRejectedValue(new Error("Provider unreachable"));
      const app = createApp(degradedDeps);

      const res = await request(app).get("/api/health").expect(200);

      expect(res.body.status).toBe("degraded");
      expect(res.body.providerStatus).toBe("degraded");
      expect(res.body.provider).toBe("mock");
    });
  });

  describe("autoApprove auth bypass prevention", () => {
    it("returns 401 when autoApprove used without authentication (apiKey set)", async () => {
      // When apiKey IS configured, unauthenticated autoApprove should be blocked
      const app = createApp({ ...deps, apiKey: "test-key-123" });
      const res = await request(app)
        .post("/api/plan")
        .send({ goal: "deploy app", autoApprove: true });
      // Unauthenticated request blocked at auth middleware (401)
      expect(res.status).toBe(401);
    });

    it("allows autoApprove when request is authenticated", async () => {
      const app = createApp({ ...deps, apiKey: "test-key-123" });
      const res = await request(app)
        .post("/api/plan")
        .set("X-API-Key", "test-key-123")
        .send({ goal: "deploy app", autoApprove: true });
      // Should not be 403 — request is authenticated
      // (may be 500 due to mock provider, but not 403)
      expect(res.status).not.toBe(403);
    });
  });

  describe("Number.parseInt NaN guards", () => {
    it("returns 200 with defaults for invalid limit/offset", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/history?limit=abc&offset=xyz").expect(200);
      expect(res.body.entries).toBeDefined();
      expect(res.body.offset).toBe(0);
    });
  });

  describe("sessionId validation", () => {
    it("rejects sessionId longer than 64 chars", async () => {
      const app = createApp(deps);
      const longId = "a".repeat(65);
      const res = await request(app)
        .post("/api/chat")
        .send({ sessionId: longId, message: "hello" });
      expect(res.status).toBe(400);
    });
  });

  describe("T-8: metrics endpoints with auth enabled", () => {
    it.each([
      "/api/metrics",
      "/api/metrics/overview",
      "/api/metrics/security",
      "/api/metrics/audit",
    ])("returns 401 for GET %s without API key when auth is enabled", async (endpoint) => {
      const authDeps = createMockDeps();
      authDeps.apiKey = "metrics-secret-key";
      const app = createApp(authDeps);
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(401);
    });

    /** Create a temp rootDir with .dojops, run a callback, then clean up. */
    async function withMetricsTmpDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
      const fsModule = await import("node:fs");
      const pathModule = await import("node:path");
      const osModule = await import("node:os");
      const tmpDir = fsModule.mkdtempSync(
        pathModule.join(osModule.tmpdir(), "dojops-metrics-test-"),
      );
      fsModule.mkdirSync(pathModule.join(tmpDir, ".dojops"), { recursive: true });
      try {
        await fn(tmpDir);
      } finally {
        fsModule.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    function createAuthApp(rootDir: string) {
      const authDeps = createMockDeps();
      authDeps.apiKey = "metrics-secret-key";
      authDeps.rootDir = rootDir;
      return createApp(authDeps);
    }

    it.each([
      ["/api/metrics", ["overview", "security", "audit", "generatedAt"]],
      ["/api/metrics/overview", ["totalPlans", "totalExecutions"]],
      ["/api/metrics/security", ["totalScans", "bySeverity"]],
      ["/api/metrics/audit", ["totalEntries", "chainIntegrity"]],
    ] as const)(
      "returns 200 for GET %s with valid API key and rootDir",
      async (endpoint, expectedProps) => {
        await withMetricsTmpDir(async (tmpDir) => {
          const app = createAuthApp(tmpDir);
          const res = await request(app).get(endpoint).set("X-API-Key", "metrics-secret-key");
          expect(res.status).toBe(200);
          for (const prop of expectedProps) {
            expect(res.body).toHaveProperty(prop);
          }
        });
      },
    );

    it("returns 403 for GET /api/metrics with wrong API key", async () => {
      const authDeps = createMockDeps();
      authDeps.apiKey = "metrics-secret-key";
      const app = createApp(authDeps);

      const res = await request(app).get("/api/metrics").set("X-API-Key", "wrong-key-value--");
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Invalid API key");
    });

    it("returns 404 for metrics when rootDir not provided (no aggregator)", async () => {
      // Without rootDir, metrics routes return 404
      const app = createApp(deps);
      const res = await request(app).get("/api/metrics");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Metrics not available");
    });
  });

  describe("T-12: CORS behavior for unknown and allowed origins", () => {
    it("does not set Access-Control-Allow-Origin for unknown origin", async () => {
      const app = createApp(deps);
      const res = await request(app)
        .options("/api/health")
        .set("Origin", "https://evil.example.com")
        .set("Access-Control-Request-Method", "GET");
      // CORS middleware should not reflect an unknown origin
      const allowOrigin = res.headers["access-control-allow-origin"];
      // Either the header is absent or it does not match the malicious origin
      if (allowOrigin) {
        expect(allowOrigin).not.toBe("https://evil.example.com");
      }
    });

    it("sets Access-Control-Allow-Origin for allowed origin", async () => {
      const customDeps = createMockDeps();
      customDeps.corsOrigin = "https://trusted.example.com";
      const app = createApp(customDeps);

      const res = await request(app)
        .get("/api/health")
        .set("Origin", "https://trusted.example.com");
      expect(res.headers["access-control-allow-origin"]).toBe("https://trusted.example.com");
    });

    it("handles OPTIONS preflight from allowed origin", async () => {
      const customDeps = createMockDeps();
      customDeps.corsOrigin = "https://trusted.example.com";
      const app = createApp(customDeps);

      const res = await request(app)
        .options("/api/generate")
        .set("Origin", "https://trusted.example.com")
        .set("Access-Control-Request-Method", "POST");
      expect(res.headers["access-control-allow-origin"]).toBe("https://trusted.example.com");
      expect(res.status).toBe(204);
    });

    it("does not reflect arbitrary origins when corsOrigin is set", async () => {
      const customDeps = createMockDeps();
      customDeps.corsOrigin = "https://trusted.example.com";
      const app = createApp(customDeps);

      const res = await request(app)
        .get("/api/health")
        .set("Origin", "https://attacker.example.com");
      // The CORS header should not reflect the attacker origin
      const allowOrigin = res.headers["access-control-allow-origin"];
      if (allowOrigin) {
        expect(allowOrigin).not.toBe("https://attacker.example.com");
      }
    });
  });
});
