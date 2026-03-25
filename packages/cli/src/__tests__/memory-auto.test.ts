import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  initMemory,
  loadMemoryConfig,
  saveMemoryConfig,
  closeMemoryDb,
  recordTask,
  queryMemory,
  buildMemoryContextString,
} from "../memory";

let tmpDir: string;

beforeEach(async () => {
  await initMemory();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-memory-auto-test-"));
});

afterEach(() => {
  closeMemoryDb(tmpDir);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadMemoryConfig / saveMemoryConfig", () => {
  it("returns true by default when no config exists", () => {
    expect(loadMemoryConfig(tmpDir)).toBe(true);
  });

  it("saves and loads autoEnrich = false", () => {
    saveMemoryConfig(tmpDir, false);
    expect(loadMemoryConfig(tmpDir)).toBe(false);
  });

  it("saves and loads autoEnrich = true", () => {
    saveMemoryConfig(tmpDir, true);
    expect(loadMemoryConfig(tmpDir)).toBe(true);
  });

  it("creates the memory directory if needed", () => {
    const configPath = path.join(tmpDir, ".dojops", "memory", "config.json");
    expect(fs.existsSync(configPath)).toBe(false);

    saveMemoryConfig(tmpDir, true);
    expect(fs.existsSync(configPath)).toBe(true);
  });
});

describe("auto-memory enrichment integration", () => {
  it("recordTask stores a task that queryMemory can retrieve", () => {
    // Simulate what auto.ts does after a successful run
    recordTask(tmpDir, {
      timestamp: new Date().toISOString(),
      task_type: "generate",
      prompt: "Create a Dockerfile for Node.js",
      result_summary: "Created Dockerfile with multi-stage build",
      status: "success",
      duration_ms: 5000,
      related_files: JSON.stringify(["Dockerfile"]),
      agent_or_skill: "auto",
      metadata: JSON.stringify({ iterations: 3, toolCalls: 5, totalTokens: 1200 }),
    });

    const ctx = queryMemory(tmpDir, "generate", "Add health check to Dockerfile");
    expect(ctx.recentTasks.length).toBeGreaterThan(0);
    expect(ctx.recentTasks[0].prompt).toBe("Create a Dockerfile for Node.js");
    expect(ctx.recentTasks[0].agent_or_skill).toBe("auto");
  });

  it("buildMemoryContextString includes recorded tasks", () => {
    recordTask(tmpDir, {
      timestamp: new Date().toISOString(),
      task_type: "generate",
      prompt: "Create Terraform S3 config",
      result_summary: "Created main.tf with S3 bucket and versioning",
      status: "success",
      duration_ms: 8000,
      related_files: JSON.stringify(["main.tf"]),
      agent_or_skill: "auto",
      metadata: "{}",
    });

    const ctx = queryMemory(tmpDir, "generate", "Add versioning to S3 bucket");
    const contextStr = buildMemoryContextString(ctx);

    expect(contextStr).not.toBeNull();
    expect(contextStr).toContain("Completed");
    expect(contextStr).toContain("S3");
  });

  it("continuation detection works for similar prompts", () => {
    recordTask(tmpDir, {
      timestamp: new Date().toISOString(),
      task_type: "generate",
      prompt: "Create Kubernetes deployment for web service",
      result_summary: "Created deployment.yaml",
      status: "success",
      duration_ms: 3000,
      related_files: JSON.stringify(["deployment.yaml"]),
      agent_or_skill: "auto",
      metadata: "{}",
    });

    const ctx = queryMemory(tmpDir, "generate", "Add service for Kubernetes web deployment");
    expect(ctx.isContinuation).toBe(true);
    expect(ctx.continuationOf).toBeDefined();
    expect(ctx.continuationOf!.prompt).toContain("Kubernetes");
  });
});
