import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LLMProvider, LLMResponse, AgentRouter, CIDebugger, InfraDiffAnalyzer } from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { HistoryStore } from "../../store";

// Mock @dojops/scanner -- controls the behavior of runScan in the scan route
const mockRunScan = vi.fn();
vi.mock("@dojops/scanner", () => ({
  runScan: (...args: unknown[]) => mockRunScan(...args),
}));

import { createApp, AppDependencies } from "../../app";

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

function createTestDeps(rootDir: string): AppDependencies {
  const provider = createMockProvider();
  const tools = [createMockTool()];
  const router = new AgentRouter(provider);
  const debugger_ = new CIDebugger(provider);
  const diffAnalyzer = new InfraDiffAnalyzer(provider);
  const store = new HistoryStore();

  return { provider, tools, router, debugger: debugger_, diffAnalyzer, store, rootDir };
}

describe("T-7: Scan timeout (DOJOPS_SCAN_TIMEOUT_MS) functional tests", () => {
  let tmpDir: string;

  beforeEach(() => {
    mockRunScan.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-scan-timeout-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns results normally when scan completes within timeout", async () => {
    const mockReport = {
      scanType: "security",
      timestamp: new Date().toISOString(),
      projectPath: tmpDir,
      results: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    };
    mockRunScan.mockResolvedValue(mockReport);

    const deps = createTestDeps(tmpDir);
    const app = createApp(deps);

    const res = await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "security",
    });

    expect(res.status).toBe(200);
    expect(res.body.scanType).toBe("security");
    expect(res.body.historyId).toBeDefined();
    expect(mockRunScan).toHaveBeenCalledWith(tmpDir, "security", undefined);
  });

  it("returns 500 with 'Scan timed out' when the scan exceeds timeout", async () => {
    // The SCAN_TIMEOUT_MS is read at module import time from the env var.
    // To test the timeout path without waiting for real time, we simulate it by
    // having runScan reject with the exact error the timeout mechanism produces.
    // This validates the full error-handling pipeline: catch -> history recording
    // -> error handler -> 500 response.
    mockRunScan.mockRejectedValue(new Error("Scan timed out"));

    const deps = createTestDeps(tmpDir);
    const app = createApp(deps);

    const res = await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "security",
    });

    // The error goes through next(err) -> errorHandler -> 500
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal server error");
    // In non-production mode, the error message is included
    expect(res.body.message).toBe("Scan timed out");
  });

  it("records failed scan with correct error in history after timeout", async () => {
    mockRunScan.mockRejectedValue(new Error("Scan timed out"));

    const deps = createTestDeps(tmpDir);
    const app = createApp(deps);

    await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "security",
    });

    // Verify the failed scan was recorded in history
    const historyRes = await request(app).get("/api/history");
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.entries).toHaveLength(1);
    expect(historyRes.body.entries[0].success).toBe(false);
    expect(historyRes.body.entries[0].error).toBe("Scan timed out");
    expect(historyRes.body.entries[0].type).toBe("scan");
  });

  it("records successful scan in history when completing within timeout", async () => {
    const mockReport = {
      scanType: "deps",
      timestamp: new Date().toISOString(),
      projectPath: tmpDir,
      results: [{ scanner: "npm-audit", findings: [] }],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    };
    mockRunScan.mockResolvedValue(mockReport);

    const deps = createTestDeps(tmpDir);
    const app = createApp(deps);

    await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "deps",
    });

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.body.entries).toHaveLength(1);
    expect(historyRes.body.entries[0].success).toBe(true);
    expect(historyRes.body.entries[0].type).toBe("scan");
  });

  it("releases scanInProgress lock after timeout so next scan can proceed", async () => {
    // First scan: simulate timeout failure
    mockRunScan.mockRejectedValueOnce(new Error("Scan timed out"));

    const deps = createTestDeps(tmpDir);
    const app = createApp(deps);

    const firstRes = await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "security",
    });
    expect(firstRes.status).toBe(500);

    // Second scan: should succeed (lock was released by the finally block)
    const mockReport = {
      scanType: "security",
      timestamp: new Date().toISOString(),
      projectPath: tmpDir,
      results: [],
      summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    };
    mockRunScan.mockResolvedValueOnce(mockReport);

    const secondRes = await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "security",
    });
    // The critical assertion: NOT a 429 (lock was released by the finally block)
    expect(secondRes.status).not.toBe(429);
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.scanType).toBe("security");
  });

  it("records duration in history even on timeout failure", async () => {
    mockRunScan.mockRejectedValue(new Error("Scan timed out"));

    const deps = createTestDeps(tmpDir);
    const app = createApp(deps);

    await request(app).post("/api/scan").send({
      target: tmpDir,
      scanType: "security",
    });

    const historyRes = await request(app).get("/api/history");
    expect(historyRes.body.entries).toHaveLength(1);
    expect(typeof historyRes.body.entries[0].durationMs).toBe("number");
    expect(historyRes.body.entries[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
