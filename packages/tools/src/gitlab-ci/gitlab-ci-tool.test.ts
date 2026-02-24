import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { GitLabCITool } from "./gitlab-ci-tool";
import { GitLabCIConfig } from "./schemas";

const mockConfig: GitLabCIConfig = {
  stages: ["lint", "test", "build"],
  variables: { NODE_VERSION: "20" },
  jobs: {
    lint: {
      stage: "lint",
      image: "node:20",
      script: ["npm ci", "npm run lint"],
    },
    test: {
      stage: "test",
      image: "node:20",
      script: ["npm ci", "npm test"],
      artifacts: { paths: ["coverage/"], expire_in: "7 days" },
    },
    build: {
      stage: "build",
      image: "node:20",
      script: ["npm ci", "npm run build"],
    },
  },
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

describe("GitLabCITool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-gitlab-ci-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new GitLabCITool(createMockProvider());
    const result = tool.validate({ projectPath: "/some/path" });
    expect(result.valid).toBe(true);
  });

  it("rejects input without projectPath", () => {
    const tool = new GitLabCITool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("returns error for unknown project type", async () => {
    const dir = makeTmpDir();
    const tool = new GitLabCITool(createMockProvider());
    const result = await tool.generate({
      projectPath: dir,
      nodeVersion: "20",
      defaultBranch: "main",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not detect project type");
  });

  it("generates GitLab CI YAML for a Node.js project", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new GitLabCITool(createMockProvider());
    const result = await tool.generate({
      projectPath: dir,
      nodeVersion: "20",
      defaultBranch: "main",
    });
    expect(result.success).toBe(true);
    const data = result.data as { yaml: string; config: GitLabCIConfig };
    expect(data.yaml).toContain("stages:");
    expect(data.config.stages).toContain("lint");
  });

  it("writes .gitlab-ci.yml on execute", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new GitLabCITool(createMockProvider());
    await tool.execute({ projectPath: dir, nodeVersion: "20", defaultBranch: "main" });
    const ciPath = path.join(dir, ".gitlab-ci.yml");
    expect(fs.existsSync(ciPath)).toBe(true);
    const content = fs.readFileSync(ciPath, "utf-8");
    expect(content).toContain("stages:");
    expect(content).toContain("lint");
  });
});
