import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { DockerfileTool } from "./dockerfile-tool";
import { DockerfileConfig } from "./schemas";
import { detectDockerContext } from "./detector";

const mockConfig: DockerfileConfig = {
  stages: [
    {
      name: "deps",
      from: "node:20-alpine",
      commands: ["WORKDIR /app", "COPY package*.json ./", "RUN npm ci"],
    },
    {
      name: "build",
      from: "deps",
      commands: ["COPY . .", "RUN npm run build"],
    },
    {
      name: "production",
      from: "node:20-alpine",
      commands: [
        "WORKDIR /app",
        "COPY --from=build /app/dist ./dist",
        "COPY --from=deps /app/node_modules ./node_modules",
        'CMD ["node", "dist/index.js"]',
      ],
    },
  ],
  dockerignorePatterns: ["node_modules", "dist", ".git", "*.md"],
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

describe("DockerfileTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-dockerfile-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new DockerfileTool(createMockProvider());
    const result = tool.validate({ projectPath: "/app", outputPath: "/out" });
    expect(result.valid).toBe(true);
  });

  it("rejects input without required fields", () => {
    const tool = new DockerfileTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("detects Node.js project with lockfile", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    const result = detectDockerContext(dir);
    expect(result.projectType).toBe("node");
    expect(result.hasLockfile).toBe(true);
    expect(result.entryFile).toBe("index.js");
  });

  it("generates multi-stage Dockerfile", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new DockerfileTool(createMockProvider());
    const result = await tool.generate({
      projectPath: dir,
      outputPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data as { dockerfile: string; dockerignore: string | null };
    expect(data.dockerfile).toContain("FROM node:20-alpine AS deps");
    expect(data.dockerfile).toContain("FROM deps AS build");
    expect(data.dockerignore).toContain("node_modules");
  });

  it("writes Dockerfile and .dockerignore on execute", async () => {
    const dir = makeTmpDir();
    const outDir = path.join(dir, "output");
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new DockerfileTool(createMockProvider());
    await tool.execute({ projectPath: dir, outputPath: outDir });
    expect(fs.existsSync(path.join(outDir, "Dockerfile"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, ".dockerignore"))).toBe(true);
    const content = fs.readFileSync(path.join(outDir, "Dockerfile"), "utf-8");
    expect(content).toContain("FROM");
  });

  it("returns error for unknown project type", async () => {
    const dir = makeTmpDir();
    const tool = new DockerfileTool(createMockProvider());
    const result = await tool.generate({ projectPath: dir, outputPath: dir });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Could not detect project type");
  });
});
