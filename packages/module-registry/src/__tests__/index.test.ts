import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

// Mock dependencies before imports
vi.mock("fs");
vi.mock("@dojops/runtime", () => {
  const DopsRuntimeV2 = vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    module: { frontmatter?: { meta?: { name?: string } } },
  ) {
    this.name = module?.frontmatter?.meta?.name ?? "mock-runtime-v2";
    this.generate = vi.fn();
  });
  return {
    DopsRuntimeV2,
    parseDopsFile: vi.fn(),
    validateDopsModule: vi.fn(),
    DocProvider: undefined,
  };
});

vi.mock("../dops-loader", () => ({
  discoverUserDopsFiles: vi.fn().mockReturnValue([]),
}));

vi.mock("../policy", () => ({
  loadModulePolicy: vi.fn().mockReturnValue(null),
  isModuleAllowed: vi.fn().mockReturnValue(true),
}));

import { loadBuiltInModules, loadUserModules, createModuleRegistry } from "../index";
import { parseDopsFile, validateDopsModule } from "@dojops/runtime";
import { discoverUserDopsFiles } from "../dops-loader";
import type { LLMProvider } from "@dojops/core";
import type { DopsFileEntry } from "../dops-loader";

const mockProvider: LLMProvider = {
  name: "mock",
  generate: vi.fn(),
};

const defaultParsedModule = {
  frontmatter: {
    dopsVersion: 2,
    meta: { name: "test-tool", version: "1.0.0", description: "Test" },
    context: { technology: "test", fileFormat: "yaml", outputGuidance: "", bestPractices: [] },
  },
  sections: { prompt: "test prompt", keywords: "test" },
  raw: "test",
};

function resetParseMock() {
  vi.mocked(parseDopsFile).mockReturnValue(defaultParsedModule as ReturnType<typeof parseDopsFile>);
  vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
}

describe("loadBuiltInModules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetParseMock();
  });

  it("returns empty array when modules dir does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = loadBuiltInModules(mockProvider);
    expect(result).toEqual([]);
  });

  it("loads valid .dops files from modules dir", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "tool1.dops",
      "tool2.dops",
      "readme.md",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = loadBuiltInModules(mockProvider);
    expect(result).toHaveLength(2);
    expect(parseDopsFile).toHaveBeenCalledTimes(2);
  });

  it("skips invalid modules silently", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["bad.dops"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: false, errors: ["bad format"] });

    const result = loadBuiltInModules(mockProvider);
    expect(result).toHaveLength(0);
  });

  it("skips files that throw during parse", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["crash.dops"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    vi.mocked(parseDopsFile).mockImplementation(() => {
      throw new Error("parse error");
    });

    const result = loadBuiltInModules(mockProvider);
    expect(result).toHaveLength(0);
  });

  it("handles fs.readdirSync throwing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    const result = loadBuiltInModules(mockProvider);
    expect(result).toEqual([]);
  });
});

describe("loadUserModules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty when no user dops files found", () => {
    vi.mocked(discoverUserDopsFiles).mockReturnValue([]);
    const result = loadUserModules(mockProvider);
    expect(result.modules).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("loads valid user dops files", () => {
    const entry: DopsFileEntry = {
      filePath: "/home/user/.dojops/tools/my-tool.dops",
      location: "global",
    };
    vi.mocked(discoverUserDopsFiles).mockReturnValue([entry]);
    vi.mocked(parseDopsFile).mockReturnValue({
      frontmatter: {
        dopsVersion: 2,
        meta: { name: "my-tool", version: "1.0.0", description: "Test" },
        context: { technology: "test", fileFormat: "yaml", outputGuidance: "", bestPractices: [] },
      },
      sections: { prompt: "test", keywords: "test" },
      raw: "test",
    } as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });

    const result = loadUserModules(mockProvider);
    expect(result.modules).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("collects warnings for invalid files", () => {
    const entry: DopsFileEntry = { filePath: "/tmp/bad.dops", location: "project" };
    vi.mocked(discoverUserDopsFiles).mockReturnValue([entry]);
    vi.mocked(parseDopsFile).mockReturnValue({
      frontmatter: {
        dopsVersion: 2,
        meta: { name: "bad", version: "1.0.0", description: "Bad" },
        context: { technology: "test", fileFormat: "yaml", outputGuidance: "", bestPractices: [] },
      },
      sections: { prompt: "test", keywords: "test" },
      raw: "test",
    } as ReturnType<typeof parseDopsFile>);
    vi.mocked(validateDopsModule).mockReturnValue({
      valid: false,
      errors: ["missing meta"],
    });

    const result = loadUserModules(mockProvider);
    expect(result.modules).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Invalid .dops file");
    expect(result.warnings[0]).toContain("missing meta");
  });

  it("collects warnings for files that throw during parse", () => {
    const entry: DopsFileEntry = { filePath: "/tmp/crash.dops", location: "project" };
    vi.mocked(discoverUserDopsFiles).mockReturnValue([entry]);
    vi.mocked(parseDopsFile).mockImplementation(() => {
      throw new Error("corrupt file");
    });

    const result = loadUserModules(mockProvider);
    expect(result.modules).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to load");
    expect(result.warnings[0]).toContain("corrupt file");
  });
});

describe("createModuleRegistry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a registry with no modules", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(discoverUserDopsFiles).mockReturnValue([]);

    const registry = createModuleRegistry(mockProvider);
    expect(registry).toBeDefined();
    expect(registry.size).toBe(0);
  });

  it("creates a registry with built-in modules", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(["tool.dops"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    vi.mocked(validateDopsModule).mockReturnValue({ valid: true });
    vi.mocked(discoverUserDopsFiles).mockReturnValue([]);

    const registry = createModuleRegistry(mockProvider);
    expect(registry).toBeDefined();
  });
});
