import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, ExecSyncOptionsWithStringEncoding } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLI_BIN = path.resolve(__dirname, "..", "dist", "index.js");

function run(
  args: string,
  opts?: { cwd?: string; expectFail?: boolean },
): { stdout: string; exitCode: number } {
  const execOpts: ExecSyncOptionsWithStringEncoding = {
    cwd: opts?.cwd,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
    timeout: 15_000,
  };

  try {
    const stdout = execSync(`node ${CLI_BIN} ${args}`, execOpts);
    return { stdout, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

describe("CLI Smoke Tests", () => {
  it("--help exits with code 0", () => {
    const { exitCode, stdout } = run("--help");
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it("no arguments shows help and exits with code 1", () => {
    const { exitCode, stdout } = run("");
    expect(exitCode).toBe(1);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it("--help output contains required sections", () => {
    const { stdout } = run("--help");
    expect(stdout).toContain("USAGE");
    expect(stdout).toContain("COMMANDS");
    expect(stdout).toContain("OPTIONS");
  });

  it("doctor command runs without LLM", () => {
    const { exitCode, stdout } = run("doctor");
    // Doctor checks system health — should succeed even without LLM key
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  describe("init in temp dir", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-smoke-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("init exits 0 and creates .dojops/", () => {
      const { exitCode } = run("init", { cwd: tmpDir });
      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(tmpDir, ".dojops"))).toBe(true);
    });

    it("init is idempotent", () => {
      run("init", { cwd: tmpDir });
      const { exitCode } = run("init", { cwd: tmpDir });
      expect(exitCode).toBe(0);
    });
  });
});
