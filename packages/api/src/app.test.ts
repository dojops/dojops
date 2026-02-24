import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { createApp, AppDependencies } from "./app";
import { HistoryStore } from "./store";

const mockDiagnosis = {
  errorType: "build" as const,
  summary: "TypeScript compilation failed",
  rootCause: "Missing type declaration",
  suggestedFixes: [
    { description: "Install @types/node", command: "npm i -D @types/node", confidence: 0.9 },
  ],
  affectedFiles: ["src/index.ts"],
  confidence: 0.85,
};

const mockAnalysis = {
  summary: "Adding S3 bucket",
  changes: [{ resource: "aws_s3_bucket.main", action: "create" as const }],
  riskLevel: "low" as const,
  riskFactors: [],
  costImpact: { direction: "increase" as const, details: "Minimal S3 storage costs" },
  securityImpact: [],
  rollbackComplexity: "trivial" as const,
  recommendations: ["Enable versioning"],
  confidence: 0.9,
};

const mockTaskGraph = {
  goal: "deploy app",
  tasks: [
    {
      id: "task-1",
      tool: "mock-tool",
      description: "Generate config",
      dependsOn: [],
      input: {},
    },
  ],
};

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockImplementation(async (req) => {
      // Return structured parsed data when schema is provided
      if (req.schema) {
        if (req.system?.includes("CI/CD debugger") || req.system?.includes("CI pipeline")) {
          return { content: JSON.stringify(mockDiagnosis), parsed: mockDiagnosis };
        }
        if (req.system?.includes("infrastructure")) {
          return { content: JSON.stringify(mockAnalysis), parsed: mockAnalysis };
        }
        if (req.system?.includes("task planner")) {
          return { content: JSON.stringify(mockTaskGraph), parsed: mockTaskGraph };
        }
      }
      return {
        content: "Mock response",
        model: "mock-model",
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      } satisfies LLMResponse;
    }),
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

describe("API Integration", () => {
  let deps: AppDependencies;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    deps = createTestDeps();
    app = createApp(deps);
  });

  describe("GET /api/health", () => {
    it("returns provider status", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.provider).toBe("mock");
      expect(res.body.tools).toContain("mock-tool");
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe("POST /api/generate", () => {
    it("returns agent-routed response", async () => {
      const res = await request(app).post("/api/generate").send({ prompt: "hello world" });
      expect(res.status).toBe(200);
      expect(res.body.content).toBeDefined();
      expect(res.body.agent).toBeDefined();
      expect(res.body.agent.name).toBeDefined();
      expect(res.body.agent.confidence).toBeGreaterThanOrEqual(0);
      expect(res.body.historyId).toBeDefined();
    });

    it("rejects empty prompt", async () => {
      const res = await request(app).post("/api/generate").send({ prompt: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("rejects missing body", async () => {
      const res = await request(app).post("/api/generate").send({});
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/plan", () => {
    it("returns task graph", async () => {
      const res = await request(app).post("/api/plan").send({ goal: "deploy app" });
      expect(res.status).toBe(200);
      expect(res.body.graph).toBeDefined();
      expect(res.body.graph.goal).toBe("deploy app");
      expect(res.body.graph.tasks).toHaveLength(1);
      expect(res.body.historyId).toBeDefined();
    });

    it("rejects empty goal", async () => {
      const res = await request(app).post("/api/plan").send({ goal: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/debug-ci", () => {
    it("returns diagnosis", async () => {
      const res = await request(app)
        .post("/api/debug-ci")
        .send({ log: "ERROR: tsc failed with exit code 1" });
      expect(res.status).toBe(200);
      expect(res.body.diagnosis).toBeDefined();
      expect(res.body.diagnosis.errorType).toBeDefined();
      expect(res.body.diagnosis.summary).toBeDefined();
      expect(res.body.historyId).toBeDefined();
    });

    it("rejects empty log", async () => {
      const res = await request(app).post("/api/debug-ci").send({ log: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/diff", () => {
    it("returns analysis for diff", async () => {
      const res = await request(app)
        .post("/api/diff")
        .send({ diff: "+ resource aws_s3_bucket main {}" });
      expect(res.status).toBe(200);
      expect(res.body.analysis).toBeDefined();
      expect(res.body.analysis.riskLevel).toBeDefined();
      expect(res.body.historyId).toBeDefined();
    });

    it("supports before/after compare mode", async () => {
      const res = await request(app)
        .post("/api/diff")
        .send({ diff: "changes", before: "old config", after: "new config" });
      expect(res.status).toBe(200);
      expect(res.body.analysis).toBeDefined();
    });

    it("rejects empty diff", async () => {
      const res = await request(app).post("/api/diff").send({ diff: "" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/agents", () => {
    it("returns list of agents", async () => {
      const res = await request(app).get("/api/agents");
      expect(res.status).toBe(200);
      expect(res.body.agents).toBeDefined();
      expect(Array.isArray(res.body.agents)).toBe(true);
      expect(res.body.agents.length).toBeGreaterThan(0);
      expect(res.body.agents[0]).toHaveProperty("name");
      expect(res.body.agents[0]).toHaveProperty("domain");
      expect(res.body.agents[0]).toHaveProperty("description");
      expect(res.body.agents[0]).toHaveProperty("keywords");
    });
  });

  describe("History API", () => {
    it("starts empty", async () => {
      const res = await request(app).get("/api/history");
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(0);
      expect(res.body.count).toBe(0);
    });

    it("records entries from other endpoints", async () => {
      await request(app).post("/api/generate").send({ prompt: "test" });

      const res = await request(app).get("/api/history");
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].type).toBe("generate");
    });

    it("filters by type", async () => {
      await request(app).post("/api/generate").send({ prompt: "test" });
      await request(app).post("/api/debug-ci").send({ log: "ERROR: build failed" });

      const res = await request(app).get("/api/history?type=generate");
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries[0].type).toBe("generate");
    });

    it("limits results", async () => {
      await request(app).post("/api/generate").send({ prompt: "test1" });
      await request(app).post("/api/generate").send({ prompt: "test2" });
      await request(app).post("/api/generate").send({ prompt: "test3" });

      const res = await request(app).get("/api/history?limit=2");
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
    });

    it("returns single entry by id", async () => {
      await request(app).post("/api/generate").send({ prompt: "test" });

      const res = await request(app).get("/api/history/1");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("1");
      expect(res.body.type).toBe("generate");
    });

    it("returns 404 for missing entry", async () => {
      const res = await request(app).get("/api/history/999");
      expect(res.status).toBe(404);
    });

    it("clears history", async () => {
      await request(app).post("/api/generate").send({ prompt: "test" });

      const delRes = await request(app).delete("/api/history");
      expect(delRes.status).toBe(200);

      const res = await request(app).get("/api/history");
      expect(res.body.entries).toHaveLength(0);
    });
  });

  describe("Unknown routes", () => {
    it("returns 404 for unknown API routes", async () => {
      const res = await request(app).get("/api/unknown");
      expect(res.status).toBe(404);
    });
  });
});
