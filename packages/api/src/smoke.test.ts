import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { vi } from "vitest";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@odaops/core";
import { DevOpsTool } from "@odaops/sdk";
import { createApp, AppDependencies } from "./app";
import { HistoryStore } from "./store";

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: "Mock response",
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
  const tools = [createMockTool()];
  const router = new AgentRouter(provider);
  const debugger_ = new CIDebugger(provider);
  const diffAnalyzer = new InfraDiffAnalyzer(provider);
  const store = new HistoryStore();

  return { provider, tools, router, debugger: debugger_, diffAnalyzer, store };
}

describe("API Smoke Tests", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp(createTestDeps());
  });

  it("app initializes without throwing", () => {
    expect(app).toBeDefined();
  });

  it("GET /api/health returns 200", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/agents returns 200 with array", async () => {
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents.length).toBeGreaterThan(0);
  });

  it("POST /api/generate with empty prompt returns 400", async () => {
    const res = await request(app).post("/api/generate").send({ prompt: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /api/plan with empty goal returns 400", async () => {
    const res = await request(app).post("/api/plan").send({ goal: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /api/debug-ci with empty log returns 400", async () => {
    const res = await request(app).post("/api/debug-ci").send({ log: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("POST /api/diff with empty diff returns 400", async () => {
    const res = await request(app).post("/api/diff").send({ diff: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("GET /api/history returns 200 with empty entries", async () => {
    const res = await request(app).get("/api/history");
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.count).toBe(0);
  });

  it("all main endpoints return non-404 status", async () => {
    const endpoints = [
      { method: "get" as const, path: "/api/health" },
      { method: "get" as const, path: "/api/agents" },
      { method: "get" as const, path: "/api/history" },
      { method: "post" as const, path: "/api/generate" },
      { method: "post" as const, path: "/api/plan" },
      { method: "post" as const, path: "/api/debug-ci" },
      { method: "post" as const, path: "/api/diff" },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.path).send({});
      expect(res.status, `${ep.method.toUpperCase()} ${ep.path} should not 404`).not.toBe(404);
    }
  });
});
