import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { MakefileTool } from "./makefile-tool";
import { MakefileConfig } from "./schemas";
import { detectMakefileContext } from "./detector";

const mockConfig: MakefileConfig = {
  variables: { NODE_ENV: "production" },
  defaultTarget: "all",
  targets: [
    {
      name: "all",
      deps: ["build", "test"],
      commands: ['@echo "Done"'],
      phony: true,
      description: "Build and test everything",
    },
    {
      name: "build",
      deps: [],
      commands: ["npm run build"],
      phony: true,
      description: "Build the project",
    },
    {
      name: "test",
      deps: [],
      commands: ["npm test"],
      phony: true,
      description: "Run tests",
    },
    {
      name: "clean",
      deps: [],
      commands: ["rm -rf dist node_modules"],
      phony: true,
      description: "Clean build artifacts",
    },
  ],
};

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(mockConfig),
      parsed: mockConfig,
    }),
  };
}

describe("MakefileTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-makefile-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new MakefileTool(createMockProvider());
    const result = tool.validate({ projectPath: "/some/path" });
    expect(result.valid).toBe(true);
  });

  it("rejects input without projectPath", () => {
    const tool = new MakefileTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("detects project type and existing Makefile", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "go.mod"), "module example");
    const result = detectMakefileContext(dir);
    expect(result.projectType).toBe("go");
    expect(result.hasExistingMakefile).toBe(false);
  });

  it("generates Makefile with tab-indented commands", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new MakefileTool(createMockProvider());
    const result = await tool.generate({ projectPath: dir });
    expect(result.success).toBe(true);
    const data = result.data as { makefile: string };
    expect(data.makefile).toContain(".PHONY:");
    expect(data.makefile).toContain(".DEFAULT_GOAL := all");
    // Verify tab indentation (critical for Makefiles)
    expect(data.makefile).toContain("\tnpm run build");
    expect(data.makefile).toContain("\tnpm test");
  });

  it("writes Makefile on execute", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new MakefileTool(createMockProvider());
    await tool.execute({ projectPath: dir });
    const makefilePath = path.join(dir, "Makefile");
    expect(fs.existsSync(makefilePath)).toBe(true);
    const content = fs.readFileSync(makefilePath, "utf-8");
    expect(content).toContain("build:");
    expect(content).toContain("\t");
  });

  it("returns error for unknown project type", async () => {
    const dir = makeTmpDir();
    const tool = new MakefileTool(createMockProvider());
    const result = await tool.generate({ projectPath: dir });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not detect project type");
  });
});
