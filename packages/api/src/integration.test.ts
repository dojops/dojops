import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@odaops/core";
import { DevOpsTool } from "@odaops/sdk";
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
      await request(app).delete("/api/history").expect(200);

      const historyRes = await request(app).get("/api/history").expect(200);
      expect(historyRes.body.entries).toHaveLength(0);
    });

    it("retrieves single history entry by id", async () => {
      const app = createApp(deps);

      await request(app).post("/api/generate").send({ prompt: "test" });

      const allHistory = await request(app).get("/api/history").expect(200);
      const id = allHistory.body.entries[0].id;

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
      expect(res.body.provider).toBe("mock");
      expect(res.body.tools).toContain("test-tool");
      expect(res.body.timestamp).toBeDefined();
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
    it("includes CORS headers on responses", async () => {
      const app = createApp(deps);
      const res = await request(app).get("/api/health");
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
    });
  });
});
