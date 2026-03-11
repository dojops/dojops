import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @clack/prompts
const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  isCancel: vi.fn(() => false),
  text: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

// Mock @dojops/core with a few test agent configs
vi.mock("@dojops/core", () => ({
  ALL_SPECIALIST_CONFIGS: [
    {
      name: "terraform-specialist",
      domain: "infrastructure",
      description: "Terraform expert",
      keywords: ["terraform"],
      toolDependencies: [],
    },
    {
      name: "docker-specialist",
      domain: "containerization",
      description: "Docker expert",
      keywords: ["docker"],
      toolDependencies: [],
    },
    {
      name: "cicd-specialist",
      domain: "ci-cd",
      description: "CI/CD expert",
      keywords: ["cicd"],
      toolDependencies: [],
    },
    {
      name: "security-auditor",
      domain: "security",
      description: "Security auditor",
      keywords: ["security"],
      toolDependencies: [],
    },
    {
      name: "cloud-architect",
      domain: "cloud-architecture",
      description: "Cloud architect",
      keywords: ["cloud"],
      toolDependencies: [],
    },
  ],
  getInstallCommand: vi.fn(() => "npm install"),
}));

// Mock @dojops/module-registry
vi.mock("@dojops/module-registry", () => ({
  discoverCustomAgents: vi.fn(() => []),
  GeneratedAgentSchema: {},
  formatAgentReadme: vi.fn(() => ""),
}));

// Mock state
vi.mock("../../state", () => ({
  findProjectRoot: vi.fn(() => "/mock/project"),
}));

// Mock preflight
vi.mock("../../preflight", () => ({
  runPreflight: vi.fn(() => ({ checks: [] })),
}));

import { agentsCommand } from "../../commands/agents";
import type { CLIContext } from "../../types";
import { CLIError } from "../../exit-codes";

function makeCtx(output = "table"): CLIContext {
  return {
    globalOpts: {
      output,
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      raw: false,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("No provider");
    },
  };
}

async function expectAgentFound(input: string, expectedAgent: string): Promise<void> {
  await agentsCommand(["info", input], makeCtx());
  const { note } = await import("@clack/prompts");
  expect(note).toHaveBeenCalledWith(expect.stringContaining(expectedAgent), expect.any(String));
}

describe("agents info — partial name matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["terraform-specialist", "terraform-specialist"],
    ["Terraform-Specialist", "terraform-specialist"],
    ["terraform", "terraform-specialist"],
    ["docker", "docker-specialist"],
    ["security", "security-auditor"],
    ["cloud", "cloud-architect"],
  ])("finds agent by input '%s' → %s", async (input, expected) => {
    await expectAgentFound(input, expected);
  });

  it("suggests close matches when agent not found by substring", async () => {
    // "form" is contained in "terraform-specialist" but isn't a prefix or full segment
    await expect(agentsCommand(["info", "form"], makeCtx())).rejects.toThrow(CLIError);
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Did you mean"));
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("terraform-specialist"));
  });

  it("shows all available agents when no match at all", async () => {
    await expect(agentsCommand(["info", "nonexistent"], makeCtx())).rejects.toThrow(CLIError);
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Available agents:"));
  });

  it("returns JSON output for agent info", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await agentsCommand(["info", "terraform"], makeCtx("json"));
    const output = spy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("terraform-specialist");
    spy.mockRestore();
  });
});
