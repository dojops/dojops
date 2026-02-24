import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { DockerComposeTool } from "./docker-compose-tool";
import { ComposeConfig } from "./schemas";
import { detectComposeContext } from "./detector";

const mockConfig: ComposeConfig = {
  services: {
    web: {
      build: { context: ".", dockerfile: "Dockerfile" },
      ports: ["3000:3000"],
      environment: { NODE_ENV: "production" },
      volumes: [],
      depends_on: ["db"],
      restart: "unless-stopped",
    },
    db: {
      image: "postgres:16",
      ports: ["5432:5432"],
      environment: { POSTGRES_PASSWORD: "secret" },
      volumes: ["pgdata:/var/lib/postgresql/data"],
      depends_on: [],
      restart: "unless-stopped",
    },
  },
  networks: {},
  volumes: { pgdata: {} },
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

describe("DockerComposeTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-compose-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new DockerComposeTool(createMockProvider());
    const result = tool.validate({ projectPath: "/some/path", services: "web with db" });
    expect(result.valid).toBe(true);
  });

  it("rejects input without required fields", () => {
    const tool = new DockerComposeTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("generates compose YAML with services", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new DockerComposeTool(createMockProvider());
    const result = await tool.generate({
      projectPath: dir,
      services: "web app with postgres",
      networkMode: "bridge",
    });
    expect(result.success).toBe(true);
    const data = result.data as { yaml: string; config: ComposeConfig };
    expect(data.yaml).toContain("services:");
    expect(data.config.services).toHaveProperty("web");
  });

  it("writes docker-compose.yml on execute", async () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const tool = new DockerComposeTool(createMockProvider());
    await tool.execute({
      projectPath: dir,
      services: "web app with postgres",
      networkMode: "bridge",
    });
    const composePath = path.join(dir, "docker-compose.yml");
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, "utf-8");
    expect(content).toContain("services:");
  });

  it("detects existing compose files and Dockerfiles", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");
    const result = detectComposeContext(dir);
    expect(result.projectType).toBe("node");
    expect(result.hasDockerfile).toBe(true);
  });
});
