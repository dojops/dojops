import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { createTestDeps } from "../test-helpers";
import type { LLMResponse } from "@dojops/core";

// Mock @dojops/runtime to avoid needing real binaries
vi.mock("@dojops/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dojops/runtime")>();
  return {
    ...actual,
    runReviewTool: vi.fn().mockReturnValue({
      tool: "yamllint",
      file: "test.yml",
      passed: true,
      issues: [],
    }),
  };
});

// Mock file discovery to avoid filesystem reads
vi.mock("@dojops/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dojops/core")>();
  return {
    ...actual,
    discoverDevOpsFiles: vi
      .fn()
      .mockReturnValue([{ path: "ci.yml", content: "name: CI\non: push" }]),
  };
});

function createReviewTestDeps() {
  const deps = createTestDeps("/tmp/test-project");

  const mockReport = {
    summary: "Review complete.",
    score: 85,
    findings: [],
    recommendedActions: [],
  };

  vi.mocked(deps.provider.generate).mockResolvedValue({
    content: JSON.stringify(mockReport),
    parsed: mockReport,
    usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
  } satisfies LLMResponse);

  return deps;
}

describe("Review route", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(createReviewTestDeps());
  });

  it("POST /api/review auto-discovers files when no files provided", async () => {
    const res = await request(app).post("/api/review").send({});
    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
    expect(res.body.filesReviewed).toBeDefined();
  });

  it("POST /api/review fails with auto-discover disabled and no files", async () => {
    const res = await request(app).post("/api/review").send({ autoDiscover: false });
    expect(res.status).toBe(500); // pipeline throws "No files provided"
  });

  it("POST /api/review accepts files with inline content", async () => {
    const res = await request(app)
      .post("/api/review")
      .send({
        files: [{ path: "test.yml", content: "key: value" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
    expect(res.body.report.score).toBe(85);
    expect(res.body.toolsRun).toBeDefined();
    expect(res.body.historyId).toBeDefined();
  });

  it("POST /api/review includes toolsRun summary", async () => {
    const res = await request(app)
      .post("/api/review")
      .send({
        files: [{ path: "ci.yml", content: "name: CI\non: push" }],
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.toolsRun)).toBe(true);
  });

  it("POST /api/review records in history", async () => {
    await request(app)
      .post("/api/review")
      .send({
        files: [{ path: "test.yml", content: "key: value" }],
      });

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.status).toBe(200);
    const reviewEntries = historyRes.body.entries.filter(
      (e: { type: string }) => e.type === "review",
    );
    expect(reviewEntries).toHaveLength(1);
  });

  it("POST /api/v1/review works on versioned path", async () => {
    const res = await request(app)
      .post("/api/v1/review")
      .send({
        files: [{ path: "test.yml", content: "key: value" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
  });

  it("POST /api/review includes filesReviewed in response", async () => {
    const res = await request(app)
      .post("/api/review")
      .send({
        files: [
          { path: "Dockerfile", content: "FROM node:20" },
          { path: "ci.yml", content: "name: CI" },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.filesReviewed).toEqual(["Dockerfile", "ci.yml"]);
  });

  it("POST /api/review rejects too many files", async () => {
    const files = Array.from({ length: 101 }, (_, i) => ({
      path: `file${i}.yml`,
      content: "key: value",
    }));

    const res = await request(app).post("/api/review").send({ files });
    expect(res.status).toBe(400);
  });
});
