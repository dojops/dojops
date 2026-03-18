import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolDependency } from "@dojops/core";

// Mock child_process before importing preflight
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}));

// Mock @clack/prompts to suppress TUI output in tests
vi.mock("@clack/prompts", () => ({
  log: { warn: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
}));

// Mock toolchain-sandbox for system tool tests
vi.mock("../toolchain-sandbox", () => ({
  TOOLCHAIN_DIR: "/mock/.dojops/toolchain",
  TOOLCHAIN_BIN_DIR: "/mock/.dojops/toolchain/bin",
  TOOLCHAIN_NODE_MODULES: "/mock/.dojops/toolchain/node_modules",
  TOOLCHAIN_NPM_BIN: "/mock/.dojops/toolchain/node_modules/.bin",
  ensureToolchainDir: vi.fn(),
  loadToolchainRegistry: vi.fn(() => ({ tools: [], updatedAt: "" })),
  installSystemTool: vi.fn(),
  verifyTool: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import {
  resolveBinary,
  runPreflight,
  preflightCheck,
  SYSTEM_TOOL_DOMAINS,
  collectMissingSystemToolsForDomains,
} from "../preflight";

const mockedExecFileSync = vi.mocked(execFileSync);

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
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    const result = resolveBinary("shellcheck");
    expect(result).toBe("/usr/bin/shellcheck");
  });

  it("returns undefined when binary is not found", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = resolveBinary("nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("runPreflight", () => {
  it("detects available binaries", () => {
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    const result = runPreflight("shell-specialist", [shellcheck]);
    expect(result.canProceed).toBe(true);
    expect(result.checks[0].available).toBe(true);
    expect(result.checks[0].resolvedPath).toBe("/usr/bin/shellcheck");
    expect(result.missingOptional).toHaveLength(0);
  });

  it("detects missing binaries", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = runPreflight("shell-specialist", [shellcheck]);
    expect(result.canProceed).toBe(true); // optional, so still can proceed
    expect(result.checks[0].available).toBe(false);
    expect(result.missingOptional).toEqual([shellcheck]);
  });

  it("blocks on missing required tools", () => {
    mockedExecFileSync.mockImplementation(() => {
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
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = preflightCheck("agent", [shellcheck, snyk]);
    expect(result).toBe(true);
  });

  it("returns false when required tool is missing", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = preflightCheck("agent", [requiredTool]);
    expect(result).toBe(false);
  });

  it("outputs JSON when json option is set", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    preflightCheck("agent", [shellcheck], { json: true });
    expect(spy).toHaveBeenCalled();
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.agentName).toBe("agent");
    expect(output.canProceed).toBe(true);
    spy.mockRestore();
  });

  it("skips output in quiet mode when all tools pass", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/shellcheck\n"));
    const result = preflightCheck("agent", [shellcheck], { quiet: true });
    expect(result).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("SYSTEM_TOOL_DOMAINS", () => {
  it("maps all 12 system tools to domains", () => {
    const expectedTools = [
      "terraform",
      "kubectl",
      "gh",
      "hadolint",
      "trivy",
      "gitleaks",
      "ansible",
      "helm",
      "shellcheck",
      "actionlint",
      "promtool",
      "circleci",
    ];
    for (const tool of expectedTools) {
      expect(SYSTEM_TOOL_DOMAINS[tool]).toBeDefined();
      expect(SYSTEM_TOOL_DOMAINS[tool].length).toBeGreaterThan(0);
    }
  });

  it("uses valid specialist domain strings", () => {
    const validDomains = new Set([
      "orchestration",
      "infrastructure",
      "container-orchestration",
      "ci-cd",
      "security",
      "observability",
      "containerization",
      "cloud-architecture",
      "networking",
      "data-storage",
      "gitops",
      "compliance",
      "ci-debugging",
      "application-security",
      "shell-scripting",
      "python-scripting",
      "voice-input",
    ]);

    for (const [, domains] of Object.entries(SYSTEM_TOOL_DOMAINS)) {
      for (const domain of domains) {
        expect(validDomains.has(domain)).toBe(true);
      }
    }
  });

  it("maps shellcheck to shell-scripting (not infrastructure)", () => {
    expect(SYSTEM_TOOL_DOMAINS.shellcheck).toContain("shell-scripting");
    expect(SYSTEM_TOOL_DOMAINS.shellcheck).not.toContain("infrastructure");
  });
});

describe("collectMissingSystemToolsForDomains", () => {
  beforeEach(() => {
    // Make all binaries appear as "not found" so domain filtering is the only factor
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
  });

  it("returns only tools matching the given domains", () => {
    const result = collectMissingSystemToolsForDomains(["container-orchestration"]);
    const names = result.map((t) => t.name);
    // kubectl and helm are in "container-orchestration"
    expect(names).toContain("kubectl");
    expect(names).toContain("helm");
    // terraform is in "infrastructure", not "container-orchestration"
    expect(names).not.toContain("terraform");
    // actionlint is in "ci-cd", not "container-orchestration"
    expect(names).not.toContain("actionlint");
  });

  it("returns ci-cd tools for ci-cd domain", () => {
    const result = collectMissingSystemToolsForDomains(["ci-cd"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("gh");
    expect(names).toContain("shellcheck");
    expect(names).toContain("actionlint");
    expect(names).toContain("circleci");
    // terraform is not in ci-cd
    expect(names).not.toContain("terraform");
  });

  it("returns observability tools for observability domain", () => {
    const result = collectMissingSystemToolsForDomains(["observability"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("promtool");
    expect(names).not.toContain("terraform");
    expect(names).not.toContain("helm");
  });

  it("returns empty array for unknown domain", () => {
    const result = collectMissingSystemToolsForDomains(["nonexistent-domain"]);
    expect(result).toHaveLength(0);
  });

  it("returns tools across multiple domains", () => {
    const result = collectMissingSystemToolsForDomains(["infrastructure", "security"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("terraform");
    expect(names).toContain("trivy");
    expect(names).toContain("gitleaks");
  });

  it("excludes tools already on PATH", () => {
    // Make only terraform resolvable
    mockedExecFileSync.mockImplementation((cmd: unknown, args: unknown) => {
      const argsArr = args as string[];
      if (argsArr[0] === "terraform") {
        return Buffer.from("/usr/bin/terraform\n");
      }
      throw new Error("not found");
    });

    const result = collectMissingSystemToolsForDomains(["infrastructure"]);
    const names = result.map((t) => t.name);
    expect(names).not.toContain("terraform");
  });
});
