import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock node:fs
vi.mock("node:fs");

// Mock @clack/prompts
const { mockLog, mockSpinner, mockConfirm, mockText, mockSelect } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockSpinner: {
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  },
  mockConfirm: vi.fn(),
  mockText: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: vi.fn(),
  spinner: vi.fn(() => mockSpinner),
  isCancel: vi.fn(() => false),
  text: mockText,
  select: mockSelect,
  confirm: mockConfirm,
}));

// Mock @dojops/runtime
vi.mock("@dojops/runtime", () => ({
  parseDopsFile: vi.fn(),
  parseDopsString: vi.fn(),
  validateDopsModule: vi.fn(),
}));

// Mock @dojops/module-registry
vi.mock("@dojops/module-registry", () => ({
  discoverTools: vi.fn(() => []),
  discoverUserDopsFiles: vi.fn(() => []),
  validateManifest: vi.fn(),
}));

// Mock @dojops/core
vi.mock("@dojops/core", () => ({
  parseAndValidate: vi.fn(),
}));

// Mock the state module
vi.mock("../../state", () => ({
  findProjectRoot: vi.fn(() => "/mock/project"),
}));

import { toolsInitCommand } from "../../commands/tools";
import { CLIContext } from "../../types";
import { CLIError } from "../../exit-codes";

// ── Helpers ────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<CLIContext["globalOpts"]>): CLIContext {
  return {
    globalOpts: {
      output: "table",
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      raw: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("No provider configured");
    },
  };
}

function makeCtxWithProvider(
  mockGenerate: ReturnType<typeof vi.fn>,
  overrides?: Partial<CLIContext["globalOpts"]>,
): CLIContext {
  return {
    ...makeCtx(overrides),
    getProvider: () => ({
      name: "test-provider",
      generate: mockGenerate,
    }),
  };
}

function resetFsMocks() {
  vi.clearAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
}

/** Run toolsInitCommand in non-interactive mode and return the written file content. */
async function initAndGetContent(name: string, ctx?: CLIContext): Promise<string> {
  await toolsInitCommand([name, "--non-interactive"], ctx ?? makeCtx());
  return String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
}

/** Set up interactive wizard responses for the LLM generation flow. */
function setupWizardResponses(opts: {
  name: string;
  description: string;
  technology: string;
  fileFormat: string;
  outputPath: string;
  useLLM: boolean;
}) {
  mockText.mockResolvedValueOnce(opts.name);
  mockText.mockResolvedValueOnce(opts.description);
  mockText.mockResolvedValueOnce(opts.technology);
  mockSelect.mockResolvedValueOnce(opts.fileFormat);
  mockText.mockResolvedValueOnce(opts.outputPath);
  if (opts.useLLM !== undefined) {
    mockConfirm.mockResolvedValueOnce(opts.useLLM);
  }
}

// ── Tests: toolsInitCommand — v2 scaffold (no LLM) ───────────────

describe("toolsInitCommand — v2 scaffold", () => {
  beforeEach(resetFsMocks);

  it("rejects with no name in non-interactive mode", async () => {
    await expect(toolsInitCommand(["--non-interactive"], makeCtx())).rejects.toThrow(CLIError);
    await expect(toolsInitCommand(["--non-interactive"], makeCtx())).rejects.toThrow(
      "Module name required",
    );
  });

  it("rejects invalid module name", async () => {
    await expect(toolsInitCommand(["MyTool", "--non-interactive"], makeCtx())).rejects.toThrow(
      "lowercase alphanumeric",
    );
  });

  it("rejects if module already exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await expect(toolsInitCommand(["my-tool", "--non-interactive"], makeCtx())).rejects.toThrow(
      "Module already exists",
    );
  });

  it("generates v2 .dops file with dops: v2 header", async () => {
    const content = await initAndGetContent("my-tool");
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(content).toContain("dops: v2");
    expect(content).not.toContain("dops: v1");
  });

  it("generates v2 file with context block instead of input/output", async () => {
    const content = await initAndGetContent("my-tool");
    for (const s of ["context:", "technology:", "fileFormat:", "outputGuidance:", "bestPractices:"])
      expect(content).toContain(s);
    for (const s of ["input:", "output:", "source: llm"]) expect(content).not.toContain(s);
  });

  it("includes all required v2 sections: Prompt and Keywords", async () => {
    const content = await initAndGetContent("redis");
    expect(content).toContain("## Prompt");
    expect(content).toContain("## Keywords");
  });

  it("includes v2 prompt variables in the prompt section", async () => {
    const content = await initAndGetContent("redis");
    for (const v of ["{outputGuidance}", "{bestPractices}", "{context7Docs}", "{projectContext}"])
      expect(content).toContain(v);
  });

  it("includes scope, risk, detection, execution, and update blocks", async () => {
    const content = await initAndGetContent("caddy");
    for (const s of ["scope:", "risk:", "detection:", "execution:", "update:", "updateMode: true"])
      expect(content).toContain(s);
  });

  it("uses tool name to derive technology and file path", async () => {
    const content = await initAndGetContent("redis");
    expect(content).toContain('technology: "Redis"');
    expect(content).toContain('path: "redis.yaml"');
    expect(content).toContain("redis, redis");
  });

  it("writes to .dojops/modules/<name>.dops", async () => {
    await initAndGetContent("my-tool");
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join(".dojops", "modules")),
      { recursive: true },
    );
    const writtenPath = String(vi.mocked(fs.writeFileSync).mock.calls[0][0]);
    expect(writtenPath).toContain("my-tool.dops");
  });

  it("includes context7Libraries block", async () => {
    const content = await initAndGetContent("postgres");
    expect(content).toContain("context7Libraries:");
  });

  it("logs success message", async () => {
    await initAndGetContent("my-tool");
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("my-tool.dops"));
  });
});

// ── Tests: toolsInitCommand — --legacy flag ───────────────────────

describe("toolsInitCommand — --legacy flag", () => {
  beforeEach(resetFsMocks);

  it("generates v1 format with --legacy flag", async () => {
    await toolsInitCommand(["old-tool", "--legacy", "--non-interactive"], makeCtx());

    // Legacy creates a tool.yaml file
    expect(fs.writeFileSync).toHaveBeenCalled();
    const writtenPath = String(vi.mocked(fs.writeFileSync).mock.calls[0][0]);
    expect(writtenPath).toContain("tool.yaml");
  });

  it("creates tool.yaml and input.schema.json for legacy", async () => {
    await toolsInitCommand(["old-tool", "--legacy", "--non-interactive"], makeCtx());

    // Should write 2 files: tool.yaml + input.schema.json
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    const paths = vi.mocked(fs.writeFileSync).mock.calls.map((c) => String(c[0]));
    expect(paths.some((p) => p.includes("tool.yaml"))).toBe(true);
    expect(paths.some((p) => p.includes("input.schema.json"))).toBe(true);
  });
});

// ── Tests: toolsInitCommand — LLM-powered generation ──────────────

describe("toolsInitCommand — LLM-powered generation", () => {
  beforeEach(resetFsMocks);

  it("uses LLM-generated content when provider responds successfully", async () => {
    const mockLLMResponse = {
      outputGuidance: "Generate a valid Redis configuration file. Output raw config directly.",
      bestPractices: [
        "Set maxmemory to prevent OOM",
        "Use requirepass for authentication",
        "Configure save intervals for persistence",
        "Set timeout to close idle connections",
        "Disable dangerous commands in production",
      ],
      context7Libraries: [{ name: "redis", query: "Redis configuration directives and syntax" }],
      prompt:
        "You are a Redis expert. Generate production-ready Redis configuration.\n\n{outputGuidance}\n\nFollow these best practices:\n{bestPractices}\n\n{context7Docs}\n\nProject context: {projectContext}",
      keywords: ["redis", "cache", "in-memory", "key-value", "database", "session", "pub-sub"],
      scopePatterns: ["redis.conf", "redis/*.conf"],
      riskLevel: "MEDIUM" as const,
      riskRationale: "Redis configuration changes affect data persistence and access control",
      detectionPaths: ["redis.conf", "redis/*.conf"],
      structuralRules: [],
    };

    const mockGenerate = vi.fn().mockResolvedValue({
      content: JSON.stringify(mockLLMResponse),
      parsed: mockLLMResponse,
    });

    setupWizardResponses({
      name: "redis",
      description: "Redis configuration generator",
      technology: "Redis",
      fileFormat: "raw",
      outputPath: "redis.conf",
      useLLM: true,
    });

    const ctx = makeCtxWithProvider(mockGenerate);
    await toolsInitCommand([], ctx);

    // Provider should have been called
    expect(mockGenerate).toHaveBeenCalledTimes(1);

    // Verify generated content is in the output
    const content = String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
    expect(content).toContain("dops: v2");
    expect(content).toContain("Set maxmemory to prevent OOM");
    expect(content).toContain("MEDIUM");
    expect(content).toContain("redis, cache, in-memory");
    for (const v of ["{outputGuidance}", "{bestPractices}", "{context7Docs}", "{projectContext}"])
      expect(content).toContain(v);
  });

  it("falls back to defaults when LLM generation fails", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API error"));

    setupWizardResponses({
      name: "caddy",
      description: "Caddy web server config",
      technology: "Caddy",
      fileFormat: "raw",
      outputPath: "Caddyfile",
      useLLM: true,
    });

    const ctx = makeCtxWithProvider(mockGenerate);
    await toolsInitCommand([], ctx);

    // Should still write a valid v2 file with defaults
    const content = String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
    expect(content).toContain("dops: v2");
    expect(content).toContain('technology: "Caddy"');
    expect(content).toContain("Follow official Caddy documentation conventions");

    // Should have warned about failure
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("API error"));
  });

  it("does not call LLM when user declines AI generation", async () => {
    const mockGenerate = vi.fn();

    setupWizardResponses({
      name: "my-tool",
      description: "My tool description",
      technology: "MyTool",
      fileFormat: "yaml",
      outputPath: "my-tool.yaml",
      useLLM: false,
    });

    const ctx = makeCtxWithProvider(mockGenerate);
    await toolsInitCommand([], ctx);

    expect(mockGenerate).not.toHaveBeenCalled();

    // Should still produce a valid v2 file
    const content = String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
    expect(content).toContain("dops: v2");
  });

  it("does not offer LLM when no provider is available", async () => {
    // Set up wizard responses without useLLM (confirm should NOT be called — no provider)
    mockText.mockResolvedValueOnce("my-tool");
    mockText.mockResolvedValueOnce("desc");
    mockText.mockResolvedValueOnce("MyTool");
    mockSelect.mockResolvedValueOnce("yaml");
    mockText.mockResolvedValueOnce("my-tool.yaml");

    const ctx = makeCtx(); // no provider
    await toolsInitCommand([], ctx);

    // confirm should not have been called
    expect(mockConfirm).not.toHaveBeenCalled();

    // Should still produce v2 file
    const content = String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
    expect(content).toContain("dops: v2");
  });

  it("passes schema to provider.generate()", async () => {
    const mockLLMResponse = {
      outputGuidance: "Generate config.",
      bestPractices: ["Practice 1", "Practice 2", "Practice 3"],
      context7Libraries: [],
      prompt: "{outputGuidance}\n{bestPractices}\n{context7Docs}\n{projectContext}",
      keywords: ["test", "config", "tool"],
      scopePatterns: ["*.yaml"],
      riskLevel: "LOW" as const,
      riskRationale: "Read-only config",
      detectionPaths: ["test.yaml"],
      structuralRules: [],
    };

    const mockGenerate = vi.fn().mockResolvedValue({
      content: JSON.stringify(mockLLMResponse),
      parsed: mockLLMResponse,
    });

    setupWizardResponses({
      name: "test-tool",
      description: "Test tool",
      technology: "TestTool",
      fileFormat: "yaml",
      outputPath: "test.yaml",
      useLLM: true,
    });

    const ctx = makeCtxWithProvider(mockGenerate);
    await toolsInitCommand([], ctx);

    const call = mockGenerate.mock.calls[0][0];
    expect(call.system).toContain("DevOps module designer");
    expect(call.schema).toBeDefined();
  });

  it("includes LLM-generated structural rules in verification block", async () => {
    const mockLLMResponse = {
      outputGuidance: "Generate YAML config.",
      bestPractices: ["Practice 1", "Practice 2", "Practice 3"],
      context7Libraries: [],
      prompt: "{outputGuidance}\n{bestPractices}\n{context7Docs}\n{projectContext}",
      keywords: ["test", "config", "yaml"],
      scopePatterns: ["*.yaml"],
      riskLevel: "LOW" as const,
      riskRationale: "Config file",
      detectionPaths: ["config.yaml"],
      structuralRules: [{ path: "version", required: true, message: "Version field is required" }],
    };

    const mockGenerate = vi.fn().mockResolvedValue({
      content: JSON.stringify(mockLLMResponse),
      parsed: mockLLMResponse,
    });

    setupWizardResponses({
      name: "yaml-tool",
      description: "YAML config",
      technology: "YAML",
      fileFormat: "yaml",
      outputPath: "config.yaml",
      useLLM: true,
    });

    const ctx = makeCtxWithProvider(mockGenerate);
    await toolsInitCommand([], ctx);

    const content = String(vi.mocked(fs.writeFileSync).mock.calls[0][1]);
    expect(content).toContain("verification:");
    expect(content).toContain("structural:");
    expect(content).toContain("Version field is required");
  });
});

// ── Tests: toolsInitCommand — non-interactive v2 defaults ─────────

describe("toolsInitCommand — non-interactive defaults", () => {
  beforeEach(resetFsMocks);

  it("produces valid v2 structure with just a name", async () => {
    const content = await initAndGetContent("nginx-custom");

    // Must have frontmatter delimiters
    const parts = content.split("---");
    expect(parts.length).toBeGreaterThanOrEqual(3);

    // Must have all v2 structural elements
    const requiredStrings = [
      "dops: v2",
      "kind: tool",
      "name: nginx-custom",
      "version: 0.1.0",
      "context:",
      "technology:",
      "fileFormat: yaml",
      "files:",
      "detection:",
      "permissions:",
      "scope:",
      "risk:",
      "execution:",
      "update:",
      "## Prompt",
      "## Keywords",
      "{outputGuidance}",
      "{bestPractices}",
      "{context7Docs}",
      "{projectContext}",
    ];
    for (const s of requiredStrings) expect(content).toContain(s);
  });

  it("auto-capitalizes technology from tool name", async () => {
    const content = await initAndGetContent("redis");
    expect(content).toContain('technology: "Redis"');
  });

  it("title-cases hyphenated tool names for technology", async () => {
    const content = await initAndGetContent("redis-config");
    expect(content).toContain('technology: "Redis Config"');
    expect(content).not.toContain("Redis-config");
  });

  it("title-cases multi-segment hyphenated names", async () => {
    const content = await initAndGetContent("my-custom-tool");
    expect(content).toContain('technology: "My Custom Tool"');
  });

  it("defaults file format to yaml", async () => {
    const content = await initAndGetContent("my-tool");
    expect(content).toContain("fileFormat: yaml");
    expect(content).toContain('path: "my-tool.yaml"');
  });

  it("defaults risk level to LOW", async () => {
    const content = await initAndGetContent("my-tool");
    expect(content).toContain("level: LOW");
  });
});
