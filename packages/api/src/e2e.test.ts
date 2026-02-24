import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { createApp, AppDependencies } from "./app";
import { createProvider, createTools } from "./factory";
import { HistoryStore } from "./store";

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

describe.skipIf(!HAS_KEY)("API E2E with real Anthropic provider", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    const provider = createProvider({ provider: "anthropic", model: MODEL });
    const tools = createTools(provider);
    const router = new AgentRouter(provider);
    const debugger_ = new CIDebugger(provider);
    const diffAnalyzer = new InfraDiffAnalyzer(provider);
    const store = new HistoryStore();

    const deps: AppDependencies = {
      provider,
      tools,
      router,
      debugger: debugger_,
      diffAnalyzer,
      store,
    };
    app = createApp(deps);
  });

  it("GET /api/health returns provider name anthropic", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.provider).toBe("anthropic");
  }, 30_000);

  it("POST /api/generate returns content and agent fields", async () => {
    const res = await request(app)
      .post("/api/generate")
      .send({ prompt: "What is Terraform? Reply in one sentence." });
    expect(res.status).toBe(200);
    expect(res.body.content).toBeTruthy();
    expect(res.body.agent).toBeDefined();
    expect(res.body.agent.name).toBeDefined();
    expect(res.body.agent.confidence).toBeGreaterThanOrEqual(0);
    expect(res.body.historyId).toBeDefined();
  }, 30_000);

  it("POST /api/plan returns tasks array", async () => {
    const res = await request(app)
      .post("/api/plan")
      .send({ goal: "Create a GitHub Actions CI pipeline for a Node.js app" });
    expect(res.status).toBe(200);
    expect(res.body.graph).toBeDefined();
    expect(res.body.graph.tasks).toBeDefined();
    expect(Array.isArray(res.body.graph.tasks)).toBe(true);
    expect(res.body.graph.tasks.length).toBeGreaterThan(0);
    expect(res.body.historyId).toBeDefined();
  }, 30_000);

  it("POST /api/debug-ci returns structured diagnosis", async () => {
    const res = await request(app)
      .post("/api/debug-ci")
      .send({
        log: `ERROR: tsc failed with exit code 2
src/index.ts(15,3): error TS2322: Type 'string' is not assignable to type 'number'.
npm ERR! code ELIFECYCLE`,
      });
    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.diagnosis.errorType).toBeDefined();
    expect(res.body.diagnosis.summary).toBeTruthy();
    expect(res.body.diagnosis.rootCause).toBeTruthy();
    expect(Array.isArray(res.body.diagnosis.suggestedFixes)).toBe(true);
    expect(res.body.historyId).toBeDefined();
  }, 30_000);

  it("POST /api/diff returns structured analysis", async () => {
    const res = await request(app)
      .post("/api/diff")
      .send({
        diff: `# aws_instance.web will be updated in-place
~ resource "aws_instance" "web" {
    ~ instance_type = "t3.micro" -> "t3.large"
      tags          = { Name = "web-server" }
  }`,
      });
    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
    expect(res.body.analysis.summary).toBeTruthy();
    expect(res.body.analysis.riskLevel).toBeDefined();
    expect(Array.isArray(res.body.analysis.changes)).toBe(true);
    expect(res.body.historyId).toBeDefined();
  }, 30_000);
});
