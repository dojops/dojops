import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { SystemdTool } from "./systemd-tool";
import { SystemdConfig } from "./schemas";

const mockConfig: SystemdConfig = {
  unit: {
    Description: "My App Service",
    After: ["network.target"],
    Wants: [],
  },
  service: {
    Type: "simple",
    ExecStart: "/usr/bin/node /opt/myapp/index.js",
    Restart: "on-failure",
    RestartSec: "5",
    User: "appuser",
    WorkingDirectory: "/opt/myapp",
    Environment: ["NODE_ENV=production", "PORT=3000"],
    StandardOutput: "journal",
    StandardError: "journal",
  },
  install: {
    WantedBy: ["multi-user.target"],
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

describe("SystemdTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-systemd-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new SystemdTool(createMockProvider());
    const result = tool.validate({
      serviceName: "myapp",
      execStart: "/usr/bin/node /opt/myapp/index.js",
      outputPath: "/tmp/systemd",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects missing required fields", () => {
    const tool = new SystemdTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("generates unit file with all sections", async () => {
    const dir = makeTmpDir();
    const tool = new SystemdTool(createMockProvider());
    const result = await tool.generate({
      serviceName: "myapp",
      execStart: "/usr/bin/node /opt/myapp/index.js",
      user: "appuser",
      workingDirectory: "/opt/myapp",
      description: "My App Service",
      outputPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data as { unitFile: string };
    expect(data.unitFile).toContain("[Unit]");
    expect(data.unitFile).toContain("[Service]");
    expect(data.unitFile).toContain("[Install]");
    expect(data.unitFile).toContain("ExecStart=/usr/bin/node /opt/myapp/index.js");
    expect(data.unitFile).toContain("User=appuser");
  });

  it("writes {name}.service file on execute", async () => {
    const dir = makeTmpDir();
    const tool = new SystemdTool(createMockProvider());
    await tool.execute({
      serviceName: "myapp",
      execStart: "/usr/bin/node /opt/myapp/index.js",
      user: "appuser",
      outputPath: dir,
    });
    const servicePath = path.join(dir, "myapp.service");
    expect(fs.existsSync(servicePath)).toBe(true);
    const content = fs.readFileSync(servicePath, "utf-8");
    expect(content).toContain("[Unit]");
    expect(content).toContain("WantedBy=multi-user.target");
  });

  it("includes environment variables in service section", async () => {
    const dir = makeTmpDir();
    const tool = new SystemdTool(createMockProvider());
    const result = await tool.generate({
      serviceName: "myapp",
      execStart: "/usr/bin/node /opt/myapp/index.js",
      outputPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data as { unitFile: string };
    expect(data.unitFile).toContain("Environment=NODE_ENV=production");
    expect(data.unitFile).toContain("Environment=PORT=3000");
  });
});
