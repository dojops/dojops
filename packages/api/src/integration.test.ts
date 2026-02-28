import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { createApp, AppDependencies } from "./app";
import { HistoryStore } from "./store";

/**
 * Integration tests that exercise full request-to-response workflows
 * through the Express app, covering multi-step operations and cross-cutting concerns.
 */

function createMockDeps(): AppDependencies {
  const provider: LLMProvider = {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: "Generated response",
    } satisfies LLMResponse),
  };

  const tool: DevOpsTool = {
    name: "test-tool",
    description: "A test tool",
    inputSchema: {} as DevOpsTool["inputSchema"],
    validate: () => ({ valid: true }),
    generate: vi.fn().mockResolvedValue({ success: true, data: {} }),
  };

  const store = new HistoryStore();
  const router = new AgentRouter(provider);
  const debugger_ = new CIDebugger(provider);
  const diffAnalyzer = new InfraDiffAnalyzer(provider);

  return { provider, tools: [tool], router, debugger: debugger_, diffAnalyzer, store };
}

describe("API integration", () => {
  let deps: AppDependencies;

  beforeEach(() => {
    deps = createMockDeps();
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
    it("rejects generate with empty body", async () => {
      const app = createApp(deps);
      await request(app).post("/api/generate").send({}).expect(400);
    });

    it("rejects plan with missing goal", async () => {
      const app = createApp(deps);
      await request(app).post("/api/plan").send({}).expect(400);
    });

    it("rejects debug-ci with missing log", async () => {
      const app = createApp(deps);
      await request(app).post("/api/debug-ci").send({}).expect(400);
    });

    it("rejects diff with missing diff", async () => {
      const app = createApp(deps);
      await request(app).post("/api/diff").send({}).expect(400);
    });
  });

  describe("health endpoint", () => {
    it("returns provider info and tool list", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/health").expect(200);

      expect(res.body.status).toBe("ok");
      expect(res.body.authRequired).toBe(false);
      expect(res.body.provider).toBe("mock");
      expect(res.body.tools).toContain("test-tool");
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
      expect(res.body.tools).toContain("test-tool");
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
          tools: ["test-tool"],
          customToolCount: 0,
          metricsEnabled: false,
        }),
      );
      expect(typeof res.body.memory).toBe("number");
      expect(res.body.memory).toBeGreaterThan(0);
      expect(typeof res.body.uptime).toBe("number");
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof res.body.timestamp).toBe("string");
      // Timestamp should be a valid ISO date
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
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
    it("returns 403 when autoApprove used without authenticated request", async () => {
      const app = createApp(deps);
      const res = await request(app)
        .post("/api/plan")
        .send({ goal: "deploy app", autoApprove: true });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/autoApprove/);
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

  describe("parseInt NaN guards", () => {
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
});
