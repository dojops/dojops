import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExitCode, CLIError } from "../exit-codes";
import { CLIContext } from "../types";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
  },
  existsSync: vi.fn(),
}));

const { mockLog, mockSpinner } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockSpinner: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  spinner: vi.fn(() => mockSpinner),
  note: vi.fn(),
}));

vi.mock("../state", () => ({
  findProjectRoot: vi.fn(() => null),
  appendAudit: vi.fn(),
  getCurrentUser: vi.fn(() => "testuser"),
}));

import { fixDepsCommand } from "../commands/fix-deps";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

function makeCtx(overrides?: Partial<CLIContext["globalOpts"]>): CLIContext {
  return {
    globalOpts: {
      output: "table",
      raw: false,
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      dryRun: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

describe("fixDepsCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof fixDepsCommand).toBe("function");
  });

  it("throws CLIError when --npm is used but no package.json found", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(fixDepsCommand(["--npm"], makeCtx())).rejects.toThrow(CLIError);

    try {
      await fixDepsCommand(["--npm"], makeCtx());
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
    }
  });

  it("throws CLIError when --pip is used but pip-audit is not installed", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("command not found");
    });

    await expect(fixDepsCommand(["--pip"], makeCtx())).rejects.toThrow(CLIError);
  });

  it("reports no vulnerabilities when npm audit returns zero", async () => {
    // package-lock.json exists
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
      return String(p).includes("package-lock.json");
    }) as typeof fs.existsSync);

    // npm audit --json returns zero vulnerabilities
    vi.mocked(execFileSync).mockReturnValue(
      Buffer.from(
        JSON.stringify({
          metadata: {
            vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
          },
        }),
      ),
    );

    await fixDepsCommand(["--npm"], makeCtx());

    expect(mockSpinner.stop).toHaveBeenCalledWith(
      expect.stringContaining("No npm vulnerabilities"),
    );
  });

  it("runs in dry-run mode without applying changes", async () => {
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
      return String(p).includes("package-lock.json");
    }) as typeof fs.existsSync);

    // Simulate 2 vulnerabilities
    const auditJson = JSON.stringify({
      metadata: {
        vulnerabilities: { info: 0, low: 1, moderate: 1, high: 0, critical: 0 },
      },
    });

    vi.mocked(execFileSync).mockReturnValue(Buffer.from(auditJson));

    await fixDepsCommand(["--npm", "--dry-run"], makeCtx());

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Dry-run"));
  });

  it("outputs JSON when --output=json and no vulnerabilities", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // detectBoth mode, no package manager found, no pip-audit
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("command not found");
    });

    await fixDepsCommand([], makeCtx({ output: "json" }));

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[]"));
    consoleSpy.mockRestore();
  });
});
