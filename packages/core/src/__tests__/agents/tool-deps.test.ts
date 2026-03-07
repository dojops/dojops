import { describe, it, expect } from "vitest";
import {
  getInstallCommand,
  aggregatePreflight,
  ToolDependency,
  ToolCheckResult,
} from "../../agents/tool-deps";

const shellcheck: ToolDependency = {
  name: "ShellCheck",
  npmPackage: "shellcheck",
  binary: "shellcheck",
  description: "Shell script linter",
  required: false,
};

const snyk: ToolDependency = {
  name: "Snyk",
  npmPackage: "snyk",
  binary: "snyk",
  description: "Vulnerability scanner",
  required: false,
};

const opaWasm: ToolDependency = {
  name: "OPA WASM",
  npmPackage: "@open-policy-agent/opa-wasm",
  description: "Policy evaluation library",
  required: false,
};

const requiredTool: ToolDependency = {
  name: "Critical Tool",
  npmPackage: "critical-tool",
  binary: "critical",
  description: "A required tool",
  required: true,
};

describe("getInstallCommand", () => {
  it("returns npx command", () => {
    expect(getInstallCommand(shellcheck, "npx")).toBe("npx shellcheck");
  });

  it("returns npm sandboxed install command", () => {
    expect(getInstallCommand(shellcheck, "npm")).toBe(
      "dojops init (installs shellcheck into ~/.dojops/toolchain/)",
    );
  });

  it("returns pnpm global add command", () => {
    expect(getInstallCommand(shellcheck, "pnpm")).toBe("pnpm add -g shellcheck");
  });

  it("handles scoped packages", () => {
    expect(getInstallCommand(opaWasm, "npx")).toBe("npx @open-policy-agent/opa-wasm");
    expect(getInstallCommand(opaWasm, "npm")).toBe(
      "dojops init (installs @open-policy-agent/opa-wasm into ~/.dojops/toolchain/)",
    );
    expect(getInstallCommand(opaWasm, "pnpm")).toBe("pnpm add -g @open-policy-agent/opa-wasm");
  });
});

describe("aggregatePreflight", () => {
  it("returns canProceed=true when all checks pass", () => {
    const checks: ToolCheckResult[] = [
      { dependency: shellcheck, available: true, resolvedPath: "/usr/bin/shellcheck" },
      { dependency: snyk, available: true, resolvedPath: "/usr/bin/snyk" },
    ];

    const result = aggregatePreflight("test-agent", checks);
    expect(result.canProceed).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([]);
    expect(result.agentName).toBe("test-agent");
    expect(result.checks).toHaveLength(2);
  });

  it("returns canProceed=true when only optional deps are missing", () => {
    const checks: ToolCheckResult[] = [
      { dependency: shellcheck, available: false },
      { dependency: snyk, available: true, resolvedPath: "/usr/bin/snyk" },
    ];

    const result = aggregatePreflight("test-agent", checks);
    expect(result.canProceed).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([shellcheck]);
  });

  it("returns canProceed=false when required deps are missing", () => {
    const checks: ToolCheckResult[] = [
      { dependency: requiredTool, available: false },
      { dependency: shellcheck, available: false },
    ];

    const result = aggregatePreflight("test-agent", checks);
    expect(result.canProceed).toBe(false);
    expect(result.missingRequired).toEqual([requiredTool]);
    expect(result.missingOptional).toEqual([shellcheck]);
  });

  it("handles empty checks array", () => {
    const result = aggregatePreflight("empty-agent", []);
    expect(result.canProceed).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([]);
    expect(result.checks).toEqual([]);
  });
});
