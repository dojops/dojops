import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@odaops/core";
import { DevOpsTool } from "@odaops/sdk";
import { createApp, AppDependencies } from "../app";
import { HistoryStore } from "../store";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "oda-metrics-route-test-"));
}

function setupOda(rootDir: string) {
  const odaDir = path.join(rootDir, ".oda");
  fs.mkdirSync(path.join(odaDir, "plans"), { recursive: true });
  fs.mkdirSync(path.join(odaDir, "execution-logs"), { recursive: true });
  fs.mkdirSync(path.join(odaDir, "scan-history"), { recursive: true });
  fs.mkdirSync(path.join(odaDir, "history"), { recursive: true });
  return odaDir;
}

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: "Mock response",
      model: "mock-model",
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

function createTestDeps(rootDir?: string): AppDependencies {
  const provider = createMockProvider();
  const tools = [createMockTool()];
  const router = new AgentRouter(provider);
  const debugger_ = new CIDebugger(provider);
  const diffAnalyzer = new InfraDiffAnalyzer(provider);
  const store = new HistoryStore();

  return { provider, tools, router, debugger: debugger_, diffAnalyzer, store, rootDir };
}

describe("Metrics API routes", () => {
  let rootDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    rootDir = createTempDir();
    setupOda(rootDir);
    app = createApp(createTestDeps(rootDir));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe("GET /api/metrics", () => {
    it("returns full dashboard metrics", async () => {
      const res = await request(app).get("/api/metrics");
      expect(res.status).toBe(200);
      expect(res.body.overview).toBeDefined();
      expect(res.body.security).toBeDefined();
      expect(res.body.audit).toBeDefined();
      expect(res.body.generatedAt).toBeDefined();
    });
  });

  describe("GET /api/metrics/overview", () => {
    it("returns overview metrics", async () => {
      const res = await request(app).get("/api/metrics/overview");
      expect(res.status).toBe(200);
      expect(res.body.totalPlans).toBe(0);
      expect(res.body.totalExecutions).toBe(0);
      expect(res.body.successRate).toBe(0);
      expect(res.body.mostUsedAgents).toEqual([]);
    });

    it("reflects plan data", async () => {
      const odaDir = path.join(rootDir, ".oda");
      fs.writeFileSync(
        path.join(odaDir, "plans", "plan-1.json"),
        JSON.stringify({
          id: "plan-1",
          goal: "test",
          createdAt: "2024-01-01",
          risk: "LOW",
          tasks: [],
          approvalStatus: "APPLIED",
        }),
      );

      const res = await request(app).get("/api/metrics/overview");
      expect(res.status).toBe(200);
      expect(res.body.totalPlans).toBe(1);
    });
  });

  describe("GET /api/metrics/security", () => {
    it("returns security metrics", async () => {
      const res = await request(app).get("/api/metrics/security");
      expect(res.status).toBe(200);
      expect(res.body.totalScans).toBe(0);
      expect(res.body.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    });
  });

  describe("GET /api/metrics/audit", () => {
    it("returns audit metrics", async () => {
      const res = await request(app).get("/api/metrics/audit");
      expect(res.status).toBe(200);
      expect(res.body.totalEntries).toBe(0);
      expect(res.body.chainIntegrity.valid).toBe(true);
      expect(res.body.byStatus).toEqual({ success: 0, failure: 0, cancelled: 0 });
    });
  });

  describe("GET /api/health", () => {
    it("includes metricsEnabled flag", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.metricsEnabled).toBe(true);
    });

    it("shows metricsEnabled false when no rootDir", async () => {
      const appNoMetrics = createApp(createTestDeps());
      const res = await request(appNoMetrics).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.metricsEnabled).toBe(false);
    });
  });

  describe("no rootDir", () => {
    it("returns 404 for metrics when no rootDir configured", async () => {
      const appNoMetrics = createApp(createTestDeps());
      const res = await request(appNoMetrics).get("/api/metrics");
      expect(res.status).toBe(404);
    });
  });
});
