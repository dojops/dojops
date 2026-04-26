import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { createTestDeps } from "./test-helpers";
import type { AppDependencies } from "../app";

// ── Generate pipeline E2E ───────────────────────────────────────────

describe("Generate pipeline — full request-to-response", () => {
  let deps: AppDependencies;

  beforeEach(() => {
    deps = createTestDeps();
  });

  it("routes prompt to specialist agent and returns structured response", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockResolvedValue({
      content: 'resource "aws_s3_bucket" "main" {\n  bucket = "my-bucket"\n}',
    });

    const app = createApp(deps);
    const res = await request(app)
      .post("/api/generate")
      .send({ prompt: "Create a Terraform config for S3" });

    expect(res.status).toBe(200);
    expect(res.body.content).toContain("aws_s3_bucket");
    expect(res.body.agent).toBeDefined();
    expect(res.body.agent.name).toBeDefined();
    expect(res.body.agent.confidence).toBeGreaterThanOrEqual(0);
    expect(res.body.agent.reason).toBeDefined();
    expect(res.body.historyId).toBeDefined();
  });

  it("includes history entry with correct type after generate", async () => {
    const app = createApp(deps);

    await request(app).post("/api/generate").send({ prompt: "Create a Dockerfile for Node.js" });

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.entries).toHaveLength(1);
    expect(historyRes.body.entries[0].type).toBe("generate");
    expect(historyRes.body.entries[0].success).toBe(true);
    expect(historyRes.body.entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes temperature to provider", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    const app = createApp(deps);

    await request(app)
      .post("/api/generate")
      .send({ prompt: "explain terraform", temperature: 0.2 });

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.2 }));
  });

  it("returns 400 for missing prompt", async () => {
    const app = createApp(deps);
    const res = await request(app).post("/api/generate").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for empty prompt string", async () => {
    const app = createApp(deps);
    const res = await request(app).post("/api/generate").send({ prompt: "" });
    expect(res.status).toBe(400);
  });

  it("records provider error in history as failed", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockRejectedValue(new Error("API key invalid"));

    const app = createApp(deps);
    const res = await request(app).post("/api/generate").send({ prompt: "anything" });

    expect(res.status).toBe(500);

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.body.entries).toHaveLength(1);
    expect(historyRes.body.entries[0].success).toBe(false);
  });
});

// ── Plan pipeline E2E ───────────────────────────────────────────────

describe("Plan pipeline — goal decomposition", () => {
  let deps: AppDependencies;

  beforeEach(() => {
    deps = createTestDeps();
  });

  it("decomposes goal into task graph", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockResolvedValue({
      content: JSON.stringify({
        tasks: [
          {
            id: "t1",
            title: "Create Dockerfile",
            tool: "dockerfile",
            description: "Multi-stage Dockerfile for Node.js",
            dependencies: [],
          },
          {
            id: "t2",
            title: "Create CI workflow",
            tool: "github-actions",
            description: "GitHub Actions workflow for build + test",
            dependencies: ["t1"],
          },
        ],
      }),
      parsed: {
        tasks: [
          {
            id: "t1",
            title: "Create Dockerfile",
            tool: "dockerfile",
            description: "Multi-stage Dockerfile for Node.js",
            dependencies: [],
          },
          {
            id: "t2",
            title: "Create CI workflow",
            tool: "github-actions",
            description: "GitHub Actions workflow for build + test",
            dependencies: ["t1"],
          },
        ],
      },
    });

    const app = createApp(deps);
    const res = await request(app)
      .post("/api/plan")
      .send({ goal: "Containerize and add CI for a Node.js app" });

    expect(res.status).toBe(200);
    expect(res.body.graph).toBeDefined();
    expect(res.body.graph.tasks).toBeDefined();
    expect(Array.isArray(res.body.graph.tasks)).toBe(true);
    expect(res.body.graph.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 for missing goal", async () => {
    const app = createApp(deps);
    const res = await request(app).post("/api/plan").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty goal string", async () => {
    const app = createApp(deps);
    const res = await request(app).post("/api/plan").send({ goal: "" });
    expect(res.status).toBe(400);
  });

  it("records plan in history", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockResolvedValue({
      content: JSON.stringify({
        tasks: [{ id: "t1", title: "Test", tool: "shell", description: "echo", dependencies: [] }],
      }),
      parsed: {
        tasks: [{ id: "t1", title: "Test", tool: "shell", description: "echo", dependencies: [] }],
      },
    });

    const app = createApp(deps);
    await request(app).post("/api/plan").send({ goal: "Create a Makefile" });

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.body.entries).toHaveLength(1);
    expect(historyRes.body.entries[0].type).toBe("plan");
  });
});

// ── Debug-CI pipeline E2E ───────────────────────────────────────────

describe("Debug-CI pipeline — log diagnosis", () => {
  let deps: AppDependencies;

  beforeEach(() => {
    deps = createTestDeps();
  });

  it("diagnoses CI log and returns structured analysis", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockResolvedValue({
      content: JSON.stringify({
        rootCause: "Missing npm dependency 'typescript'",
        fix: "Add typescript to devDependencies",
        confidence: 0.9,
      }),
      parsed: {
        rootCause: "Missing npm dependency 'typescript'",
        fix: "Add typescript to devDependencies",
        confidence: 0.9,
      },
    });

    const app = createApp(deps);
    const res = await request(app).post("/api/debug-ci").send({
      log: "Error: Cannot find module 'typescript'\n  at Module._resolveFilename\n  npm ERR! code 1",
    });

    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
  });

  it("records debug-ci in history", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockResolvedValue({
      content: JSON.stringify({ rootCause: "test", fix: "fix", confidence: 0.5 }),
      parsed: { rootCause: "test", fix: "fix", confidence: 0.5 },
    });

    const app = createApp(deps);
    await request(app).post("/api/debug-ci").send({ log: "ERROR: build failed" });

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.body.entries[0].type).toBe("debug-ci");
  });
});

// ── Diff analysis pipeline E2E ──────────────────────────────────────

describe("Diff pipeline — infrastructure change analysis", () => {
  let deps: AppDependencies;

  beforeEach(() => {
    deps = createTestDeps();
  });

  it("analyzes diff and returns risk assessment", async () => {
    const mockGenerate = vi.mocked(deps.provider.generate);
    mockGenerate.mockResolvedValue({
      content: JSON.stringify({
        risk: "MEDIUM",
        summary: "Adding new S3 bucket",
        changes: [{ resource: "aws_s3_bucket.main", action: "create" }],
      }),
      parsed: {
        risk: "MEDIUM",
        summary: "Adding new S3 bucket",
        changes: [{ resource: "aws_s3_bucket.main", action: "create" }],
      },
    });

    const app = createApp(deps);
    const res = await request(app).post("/api/diff").send({
      diff: '+ resource "aws_s3_bucket" "main" {\n+   bucket = "prod-data"\n+ }',
    });

    expect(res.status).toBe(200);
    expect(res.body.analysis).toBeDefined();
  });
});

// ── Agents listing E2E ──────────────────────────────────────────────

describe("Agents pipeline — specialist listing", () => {
  it("returns all specialist agents with domains", async () => {
    const deps = createTestDeps();
    const app = createApp(deps);
    const res = await request(app).get("/api/agents");

    expect(res.status).toBe(200);
    expect(res.body.agents).toBeDefined();
    expect(res.body.agents.length).toBeGreaterThan(10);

    const agent = res.body.agents[0];
    expect(agent.name).toBeDefined();
    expect(agent.domain).toBeDefined();
    expect(agent.description).toBeDefined();
    expect(agent.keywords).toBeDefined();
    expect(Array.isArray(agent.keywords)).toBe(true);
  });
});

// ── Cross-route: History lifecycle ──────────────────────────────────

describe("History lifecycle — create, list, get, clear", () => {
  it("tracks multiple operation types then clears", async () => {
    const deps = createTestDeps();
    const app = createApp(deps);

    await request(app).post("/api/generate").send({ prompt: "explain docker" });
    await request(app).post("/api/generate").send({ prompt: "create nginx config" });

    const listRes = await request(app).get("/api/history");
    expect(listRes.body.entries).toHaveLength(2);
    expect(listRes.body.count).toBe(2);

    const id = listRes.body.entries[0].id;
    const singleRes = await request(app).get(`/api/history/${id}`);
    expect(singleRes.status).toBe(200);
    expect(singleRes.body.id).toBe(id);

    await request(app).delete("/api/history").set("X-Confirm", "clear").expect(200);

    const emptyRes = await request(app).get("/api/history");
    expect(emptyRes.body.entries).toHaveLength(0);
  });
});

// ── Health endpoint ─────────────────────────────────────────────────

describe("Health endpoint — provider status", () => {
  it("reports provider name and status", async () => {
    const deps = createTestDeps();
    const app = createApp(deps);
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.provider).toBe("mock");
  });
});

// ── V1 route prefix ─────────────────────────────────────────────────

describe("V1 route prefix — dual mount", () => {
  it("serves same endpoints at /api/v1/ prefix", async () => {
    const deps = createTestDeps();
    const app = createApp(deps);

    const healthRes = await request(app).get("/api/v1/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe("ok");

    const agentsRes = await request(app).get("/api/v1/agents");
    expect(agentsRes.status).toBe(200);
    expect(agentsRes.body.agents).toBeDefined();
  });
});
