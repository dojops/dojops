import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// Mock node:fs
vi.mock("node:fs");

// Mock @clack/prompts
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
    message: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: vi.fn(),
  spinner: vi.fn(() => mockSpinner),
  isCancel: vi.fn(() => false),
}));

// Mock @dojops/runtime
vi.mock("@dojops/runtime", () => ({
  parseDopsFile: vi.fn(),
  parseDopsString: vi.fn(),
  validateDopsModule: vi.fn(),
}));

// Mock @dojops/tool-registry
vi.mock("@dojops/tool-registry", () => ({
  discoverTools: vi.fn(() => []),
  discoverUserDopsFiles: vi.fn(() => []),
  validateManifest: vi.fn(),
}));

// Mock the state module
vi.mock("../../state", () => ({
  findProjectRoot: vi.fn(() => "/mock/project"),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { toolsPublishCommand, toolsInstallCommand } from "../../commands/tools";
import { parseDopsFile, parseDopsString, validateDopsModule } from "@dojops/runtime";
import { CLIContext } from "../../types";
import { CLIError } from "../../exit-codes";

// ── Helpers ────────────────────────────────────────────────────────

const SAMPLE_DOPS_CONTENT = `---
dops: v1
kind: tool
meta:
  name: test-tool
  version: 1.0.0
  description: "A test tool"
  tags: [test]
input:
  fields:
    outputPath:
      type: string
      required: true
output:
  type: object
  required: [content]
  properties:
    content:
      type: object
files:
  - path: "{outputPath}/test.yaml"
    format: yaml
    source: llm
permissions:
  filesystem: write
  child_process: none
  network: none
---
# test-tool

## Prompt

You are a test tool.

## Keywords

test
`;

const SAMPLE_BUFFER = Buffer.from(SAMPLE_DOPS_CONTENT, "utf-8");
const SAMPLE_SHA256 = crypto.createHash("sha256").update(SAMPLE_BUFFER).digest("hex");

const MOCK_FRONTMATTER = {
  meta: { name: "test-tool", version: "1.0.0", description: "A test tool", tags: ["test"] },
  input: { fields: { outputPath: { type: "string", required: true } } },
  output: { type: "object", required: ["content"], properties: { content: { type: "object" } } },
  files: [{ path: "{outputPath}/test.yaml", format: "yaml", source: "llm" }],
  permissions: { filesystem: "write", child_process: "none", network: "none" },
};

const MOCK_MODULE = {
  frontmatter: MOCK_FRONTMATTER,
  sections: { prompt: "You are a test tool.", keywords: "test" },
};

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
      throw new Error("not implemented");
    },
  };
}

// ── Tests: toolsPublishCommand ─────────────────────────────────────

describe("toolsPublishCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DOJOPS_HUB_TOKEN;
    delete process.env.DOJOPS_HUB_URL;
  });

  it("rejects with no arguments", async () => {
    await expect(toolsPublishCommand([], makeCtx())).rejects.toThrow(CLIError);
    await expect(toolsPublishCommand([], makeCtx())).rejects.toThrow(
      "Path to .dops file or tool name required",
    );
  });

  it("rejects if .dops file does not exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await expect(toolsPublishCommand(["missing-tool"], makeCtx())).rejects.toThrow(CLIError);
    await expect(toolsPublishCommand(["missing-tool"], makeCtx())).rejects.toThrow(
      'No .dops file found for "missing-tool"',
    );
  });

  it("rejects if validation fails", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockImplementation(() => {
      throw new Error("Invalid YAML frontmatter");
    });

    await expect(toolsPublishCommand(["test.dops"], makeCtx())).rejects.toThrow("Failed to parse");
  });

  it("rejects if no DOJOPS_HUB_TOKEN is set", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    await expect(toolsPublishCommand(["test.dops"], makeCtx())).rejects.toThrow(
      "No hub auth token",
    );
  });

  it("computes SHA-256 and includes it in the upload", async () => {
    process.env.DOJOPS_HUB_TOKEN = "test-token";

    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "test-tool", version: "1.0.0", created: true }),
    });

    await toolsPublishCommand(["test.dops"], makeCtx());

    // Verify fetch was called with multipart body containing sha256 field
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/packages");
    expect(opts.method).toBe("POST");

    // The body should contain the sha256 field
    const bodyStr = opts.body.toString("utf-8");
    expect(bodyStr).toContain('name="sha256"');
    expect(bodyStr).toContain(SAMPLE_SHA256);

    // Verify the hash was displayed
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining(SAMPLE_SHA256));
  });

  it("sends the auth token as a Bearer header", async () => {
    process.env.DOJOPS_HUB_TOKEN = "dojops_abc123def456";

    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "test-tool", version: "1.0.0", created: true }),
    });

    await toolsPublishCommand(["test.dops"], makeCtx());

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer dojops_abc123def456");
    expect(opts.headers.Cookie).toBeUndefined();
  });

  it("throws CLIError on hub error response", async () => {
    process.env.DOJOPS_HUB_TOKEN = "test-token";

    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Version 1.0.0 already exists" }),
    });

    await expect(toolsPublishCommand(["test.dops"], makeCtx())).rejects.toThrow(
      "Version 1.0.0 already exists",
    );
  });

  it("extracts --changelog flag", async () => {
    process.env.DOJOPS_HUB_TOKEN = "test-token";

    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "test-tool", version: "1.0.0", created: true }),
    });

    await toolsPublishCommand(["test.dops", "--changelog", "Initial release"], makeCtx());

    const bodyStr = mockFetch.mock.calls[0][1].body.toString("utf-8");
    expect(bodyStr).toContain('name="changelog"');
    expect(bodyStr).toContain("Initial release");
  });

  it("resolves .dops file by name from project tools dir", async () => {
    process.env.DOJOPS_HUB_TOKEN = "test-token";

    // Only the project tools path should exist
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p) === path.join("/mock/project", ".dojops", "tools", "my-tool.dops");
    });
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "my-tool", version: "1.0.0", created: true }),
    });

    await toolsPublishCommand(["my-tool"], makeCtx());
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on network failure", async () => {
    process.env.DOJOPS_HUB_TOKEN = "test-token";

    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(".dops"));
    vi.mocked(parseDopsFile).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(fs.readFileSync).mockReturnValue(SAMPLE_BUFFER);

    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(toolsPublishCommand(["test.dops"], makeCtx())).rejects.toThrow(
      "Failed to connect to hub",
    );
  });
});

// ── Tests: toolsInstallCommand ─────────────────────────────────────

describe("toolsInstallCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DOJOPS_HUB_URL;
  });

  it("rejects with no arguments", async () => {
    await expect(toolsInstallCommand([], makeCtx())).rejects.toThrow(CLIError);
    await expect(toolsInstallCommand([], makeCtx())).rejects.toThrow("Tool name required");
  });

  it("fetches package info and downloads latest version", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    // Mock package info response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    // Mock download response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        SAMPLE_BUFFER.buffer.slice(
          SAMPLE_BUFFER.byteOffset,
          SAMPLE_BUFFER.byteOffset + SAMPLE_BUFFER.byteLength,
        ),
      headers: new Map([["x-checksum-sha256", SAMPLE_SHA256]]) as unknown as Headers,
    });

    vi.mocked(parseDopsString).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsString>);

    await toolsInstallCommand(["test-tool"], makeCtx());

    // Verify two fetch calls: info + download
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/packages/test-tool");
    expect(mockFetch.mock.calls[1][0]).toContain("/api/download/test-tool/1.0.0");

    // Verify file was written
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = String(vi.mocked(fs.writeFileSync).mock.calls[0][0]);
    expect(writtenPath).toContain("test-tool.dops");
  });

  it("rejects when tool not found on hub (404)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });

    await expect(toolsInstallCommand(["nonexistent"], makeCtx())).rejects.toThrow(
      'Tool "nonexistent" not found on hub',
    );
  });

  it("rejects when package has no versions", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "empty-tool",
        slug: "empty-tool",
        latestVersion: null,
      }),
    });

    await expect(toolsInstallCommand(["empty-tool"], makeCtx())).rejects.toThrow(
      "no published versions",
    );
  });

  it("fails integrity check when hash mismatches", async () => {
    const tamperedBuffer = Buffer.from("tampered content", "utf-8");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        tamperedBuffer.buffer.slice(
          tamperedBuffer.byteOffset,
          tamperedBuffer.byteOffset + tamperedBuffer.byteLength,
        ),
      headers: new Map([["x-checksum-sha256", SAMPLE_SHA256]]) as unknown as Headers,
    });

    await expect(toolsInstallCommand(["test-tool"], makeCtx())).rejects.toThrow(
      "integrity check failed",
    );
  });

  it("passes integrity check when hash matches", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        SAMPLE_BUFFER.buffer.slice(
          SAMPLE_BUFFER.byteOffset,
          SAMPLE_BUFFER.byteOffset + SAMPLE_BUFFER.byteLength,
        ),
      headers: new Map([["x-checksum-sha256", SAMPLE_SHA256]]) as unknown as Headers,
    });

    vi.mocked(parseDopsString).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsString>);

    await toolsInstallCommand(["test-tool"], makeCtx());

    // Should succeed — file written
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("warns when no publisher hash is available", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    // No x-checksum-sha256 header
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        SAMPLE_BUFFER.buffer.slice(
          SAMPLE_BUFFER.byteOffset,
          SAMPLE_BUFFER.byteOffset + SAMPLE_BUFFER.byteLength,
        ),
      headers: new Map() as unknown as Headers,
    });

    vi.mocked(parseDopsString).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsString>);

    await toolsInstallCommand(["test-tool"], makeCtx());

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("No publisher hash available"),
    );
  });

  it("uses --version flag to install specific version", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    // When --version is provided, it should skip the info fetch and go directly to download
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        SAMPLE_BUFFER.buffer.slice(
          SAMPLE_BUFFER.byteOffset,
          SAMPLE_BUFFER.byteOffset + SAMPLE_BUFFER.byteLength,
        ),
      headers: new Map([["x-checksum-sha256", SAMPLE_SHA256]]) as unknown as Headers,
    });

    vi.mocked(parseDopsString).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsString>);

    await toolsInstallCommand(["test-tool", "--version", "2.0.0"], makeCtx());

    // Should only make one fetch call (download), not two (info + download)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain("/api/download/test-tool/2.0.0");
  });

  it("installs to global dir with --global flag", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        SAMPLE_BUFFER.buffer.slice(
          SAMPLE_BUFFER.byteOffset,
          SAMPLE_BUFFER.byteOffset + SAMPLE_BUFFER.byteLength,
        ),
      headers: new Map([["x-checksum-sha256", SAMPLE_SHA256]]) as unknown as Headers,
    });

    vi.mocked(parseDopsString).mockReturnValue(MOCK_MODULE as ReturnType<typeof parseDopsString>);

    await toolsInstallCommand(["test-tool", "--global"], makeCtx());

    const writtenPath = String(vi.mocked(fs.writeFileSync).mock.calls[0][0]);
    expect(writtenPath).toContain(".dojops");
    expect(writtenPath).toContain("tools");
    expect(writtenPath).toContain("test-tool.dops");
  });

  it("rejects when download fails (404 version)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(toolsInstallCommand(["test-tool"], makeCtx())).rejects.toThrow(
      "Version 1.0.0 not found",
    );
  });

  it("rejects when downloaded file is invalid .dops", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "test-tool",
        slug: "test-tool",
        latestVersion: { semver: "1.0.0" },
      }),
    });

    const badBuffer = Buffer.from("not a valid dops file", "utf-8");
    const badHash = crypto.createHash("sha256").update(badBuffer).digest("hex");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () =>
        badBuffer.buffer.slice(badBuffer.byteOffset, badBuffer.byteOffset + badBuffer.byteLength),
      headers: new Map([["x-checksum-sha256", badHash]]) as unknown as Headers,
    });

    vi.mocked(parseDopsString).mockImplementation(() => {
      throw new Error("Invalid frontmatter");
    });

    await expect(toolsInstallCommand(["test-tool"], makeCtx())).rejects.toThrow(
      "not a valid .dops module",
    );
  });

  it("throws on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(toolsInstallCommand(["test-tool"], makeCtx())).rejects.toThrow(
      "Failed to connect to hub",
    );
  });
});

// ── Tests: SHA-256 computation ────────────────────────────────────

describe("SHA-256 integrity", () => {
  it("produces consistent hash for the same content", () => {
    const content = Buffer.from("hello world");
    const hash1 = crypto.createHash("sha256").update(content).digest("hex");
    const hash2 = crypto.createHash("sha256").update(content).digest("hex");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("produces different hash for different content", () => {
    const hash1 = crypto.createHash("sha256").update(Buffer.from("original")).digest("hex");
    const hash2 = crypto.createHash("sha256").update(Buffer.from("tampered")).digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("SAMPLE_SHA256 matches the expected hash of SAMPLE_DOPS_CONTENT", () => {
    const computed = crypto.createHash("sha256").update(SAMPLE_BUFFER).digest("hex");
    expect(computed).toBe(SAMPLE_SHA256);
  });
});

// ── Tests: parseCommandPath for tools publish/install ─────────────

describe("parseCommandPath — tools publish/install", () => {
  // Import the parser directly for these tests
  it("parses tools publish as nested command", async () => {
    const { parseCommandPath } = await import("../../parser");
    const { command, positional } = parseCommandPath(["tools", "publish", "my-tool.dops"]);
    expect(command).toEqual(["tools", "publish"]);
    expect(positional).toEqual(["my-tool.dops"]);
  });

  it("parses tools install as nested command", async () => {
    const { parseCommandPath } = await import("../../parser");
    const { command, positional } = parseCommandPath(["tools", "install", "nginx-config"]);
    expect(command).toEqual(["tools", "install"]);
    expect(positional).toEqual(["nginx-config"]);
  });

  it("parses tools publish with --changelog flag", async () => {
    const { parseCommandPath } = await import("../../parser");
    const { command, positional } = parseCommandPath([
      "tools",
      "publish",
      "my-tool.dops",
      "--changelog",
      "Initial release",
    ]);
    expect(command).toEqual(["tools", "publish"]);
    expect(positional).toEqual(["my-tool.dops", "--changelog", "Initial release"]);
  });

  it("parses tools install with --version and --global flags", async () => {
    const { parseCommandPath } = await import("../../parser");
    const { command, positional } = parseCommandPath([
      "tools",
      "install",
      "nginx-config",
      "--version",
      "1.0.0",
      "--global",
    ]);
    expect(command).toEqual(["tools", "install"]);
    expect(positional).toEqual(["nginx-config", "--version", "1.0.0", "--global"]);
  });
});
