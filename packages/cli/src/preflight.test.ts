import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolDependency } from "@dojops/core";

// Mock child_process before importing preflight
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock @clack/prompts to suppress TUI output in tests
vi.mock("@clack/prompts", () => ({
  log: { warn: vi.fn(), error: vi.fn() },
}));

import { execSync } from "node:child_process";
import { resolveBinary, runPreflight, preflightCheck } from "./preflight";

const mockedExecSync = vi.mocked(execSync);

const shellcheck: ToolDependency = {
  name: "ShellCheck",
  npmPackage: "shellcheck",
  binary: "shellcheck",
  description: "Shell script linting",
  required: false,
};

const snyk: ToolDependency = {
  name: "Snyk",
  npmPackage: "snyk",
  binary: "snyk",
  description: "Vulnerability scanning",
  required: false,
};

const requiredTool: ToolDependency = {
  name: "Critical",
  npmPackage: "critical-tool",
  binary: "critical",
  description: "A required tool",
  required: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveBinary", () => {
  it("returns path when binary is found", () => {
    mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    const result = resolveBinary("shellcheck");
    expect(result).toBe("/usr/bin/shellcheck");
  });

  it("returns undefined when binary is not found", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = resolveBinary("nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("runPreflight", () => {
  it("detects available binaries", () => {
    mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    const result = runPreflight("shell-specialist", [shellcheck]);
    expect(result.canProceed).toBe(true);
    expect(result.checks[0].available).toBe(true);
    expect(result.checks[0].resolvedPath).toBe("/usr/bin/shellcheck");
    expect(result.missingOptional).toHaveLength(0);
  });

  it("detects missing binaries", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = runPreflight("shell-specialist", [shellcheck]);
    expect(result.canProceed).toBe(true); // optional, so still can proceed
    expect(result.checks[0].available).toBe(false);
    expect(result.missingOptional).toEqual([shellcheck]);
  });

  it("blocks on missing required tools", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = runPreflight("test-agent", [requiredTool]);
    expect(result.canProceed).toBe(false);
    expect(result.missingRequired).toEqual([requiredTool]);
  });

  it("returns clean result for empty deps", () => {
    const result = runPreflight("empty-agent", []);
    expect(result.canProceed).toBe(true);
    expect(result.checks).toEqual([]);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([]);
  });
});

describe("preflightCheck", () => {
  it("returns true immediately for empty deps", () => {
    const result = preflightCheck("agent", []);
    expect(result).toBe(true);
  });

  it("returns true for optional missing tools", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = preflightCheck("agent", [shellcheck, snyk]);
    expect(result).toBe(true);
  });

  it("returns false when required tool is missing", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = preflightCheck("agent", [requiredTool]);
    expect(result).toBe(false);
  });

  it("outputs JSON when json option is set", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    preflightCheck("agent", [shellcheck], { json: true });
    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.agentName).toBe("agent");
    expect(output.canProceed).toBe(true);
    spy.mockRestore();
  });

  it("skips output in quiet mode when all tools pass", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockedExecSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    const result = preflightCheck("agent", [shellcheck], { quiet: true });
    expect(result).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
