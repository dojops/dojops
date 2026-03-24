import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { verifyCommand } from "../../commands/verify";
import { ExitCode, CLIError } from "../../exit-codes";

vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

vi.mock("@dojops/runtime", () => ({
  verifyWithBinary: vi.fn().mockResolvedValue({
    passed: true,
    tool: "mock-tool",
    issues: [{ severity: "warning", message: "binary not found — skipped" }],
  }),
}));

// Mock runBin so terraform/helm calls don't depend on installed binaries
vi.mock("@dojops/sdk", () => ({
  runBin: vi.fn().mockImplementation(() => {
    const err = new Error("command not found") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  }),
}));

describe("verifyCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-verify-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when no file path is given", async () => {
    await expect(verifyCommand([])).rejects.toThrow(CLIError);
    try {
      await verifyCommand([]);
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
    }
  });

  it("throws when file does not exist", async () => {
    await expect(verifyCommand(["/nonexistent/file.tf"])).rejects.toThrow(CLIError);
  });

  it("throws for unsupported file types", async () => {
    const file = path.join(tmpDir, "readme.txt");
    fs.writeFileSync(file, "hello");
    await expect(verifyCommand([file])).rejects.toThrow(CLIError);
    try {
      await verifyCommand([file]);
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
    }
  });

  it("routes Dockerfile to hadolint", async () => {
    const file = path.join(tmpDir, "Dockerfile");
    fs.writeFileSync(file, "FROM node:20\nRUN echo hello");
    // verifyWithBinary is mocked, so it returns skipped
    const result = verifyCommand([file]);
    await expect(result).resolves.toBeUndefined();
  });

  it("routes Dockerfile.dev to hadolint", async () => {
    const file = path.join(tmpDir, "Dockerfile.dev");
    fs.writeFileSync(file, "FROM node:20");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes .yaml with apiVersion+kind to kubectl", async () => {
    const file = path.join(tmpDir, "deploy.yaml");
    fs.writeFileSync(file, "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: test");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes .yml with services to docker compose", async () => {
    const file = path.join(tmpDir, "compose.yml");
    fs.writeFileSync(file, "services:\n  web:\n    image: nginx");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes .yaml with hosts+tasks to ansible", async () => {
    const file = path.join(tmpDir, "playbook.yaml");
    fs.writeFileSync(
      file,
      "- hosts: all\n  tasks:\n    - name: test\n      debug:\n        msg: hi",
    );
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes .yml with global+scrape_configs to prometheus", async () => {
    const file = path.join(tmpDir, "prom.yml");
    fs.writeFileSync(file, "global:\n  scrape_interval: 15s\nscrape_configs:\n  - job_name: test");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("detects GitHub Actions YAML (on + jobs)", async () => {
    const file = path.join(tmpDir, "ci.yml");
    fs.writeFileSync(
      file,
      "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4",
    );
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("detects GitLab CI YAML (stages + script)", async () => {
    const file = path.join(tmpDir, ".gitlab-ci.yml");
    fs.writeFileSync(
      file,
      "stages:\n  - build\nbuild:\n  stage: build\n  script:\n    - echo build",
    );
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("returns warning for unrecognized YAML type", async () => {
    const file = path.join(tmpDir, "data.yaml");
    fs.writeFileSync(file, "foo: bar\nbaz: 123");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("skips flags when finding file path", async () => {
    const file = path.join(tmpDir, "Dockerfile");
    fs.writeFileSync(file, "FROM node:20");
    await expect(verifyCommand(["--verbose", file])).resolves.toBeUndefined();
  });

  it("routes .tf to terraform (skipped when not installed)", async () => {
    const file = path.join(tmpDir, "main.tf");
    fs.writeFileSync(file, 'resource "aws_s3_bucket" "b" { bucket = "my-bucket" }');
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes custom terraform filename", async () => {
    const file = path.join(tmpDir, "network.tf");
    fs.writeFileSync(file, 'variable "region" { default = "us-east-1" }');
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes Chart.yaml to helm lint (skipped when not installed)", async () => {
    const file = path.join(tmpDir, "Chart.yaml");
    fs.writeFileSync(file, "apiVersion: v2\nname: my-chart\nversion: 0.1.0");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("routes values.yaml to helm lint", async () => {
    const file = path.join(tmpDir, "values.yaml");
    fs.writeFileSync(file, "replicaCount: 2\nimage:\n  repository: nginx");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });

  it("handles failed verification result", async () => {
    const { verifyWithBinary } = await import("@dojops/runtime");
    vi.mocked(verifyWithBinary).mockResolvedValueOnce({
      passed: false,
      tool: "hadolint",
      issues: [{ severity: "error", message: "DL3006 Always tag the version" }],
    });
    const file = path.join(tmpDir, "Dockerfile");
    fs.writeFileSync(file, "FROM node\nRUN echo hello");
    await expect(verifyCommand([file])).rejects.toThrow(CLIError);
  });

  it("detects .gitlab-ci.yaml filename variant", async () => {
    const file = path.join(tmpDir, ".gitlab-ci.yaml");
    fs.writeFileSync(file, "build:\n  script:\n    - echo build");
    await expect(verifyCommand([file])).resolves.toBeUndefined();
  });
});
