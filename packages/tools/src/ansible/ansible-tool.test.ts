import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { AnsibleTool } from "./ansible-tool";
import { AnsiblePlaybook } from "./schemas";

const mockPlaybook: AnsiblePlaybook = {
  tasks: [
    {
      name: "Update apt cache",
      module: "apt",
      args: { update_cache: "yes" },
    },
    {
      name: "Install nginx",
      module: "apt",
      args: { name: "nginx", state: "present" },
      notify: "Restart nginx",
    },
    {
      name: "Start nginx",
      module: "service",
      args: { name: "nginx", state: "started", enabled: "yes" },
    },
  ],
  handlers: [
    {
      name: "Restart nginx",
      module: "service",
      args: { name: "nginx", state: "restarted" },
    },
  ],
  variables: { nginx_port: 80 },
};

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(mockPlaybook),
      parsed: mockPlaybook,
    }),
  };
}

describe("AnsibleTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-ansible-tool-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new AnsibleTool(createMockProvider());
    const result = tool.validate({
      playbookName: "setup-nginx",
      tasks: "Install and configure nginx",
      outputPath: "/tmp",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects input without required fields", () => {
    const tool = new AnsibleTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("rejects invalid targetOS", () => {
    const tool = new AnsibleTool(createMockProvider());
    const result = tool.validate({
      playbookName: "test",
      targetOS: "windows",
      tasks: "something",
      outputPath: "/tmp",
    });
    expect(result.valid).toBe(false);
  });

  it("generates playbook YAML with tasks and handlers", async () => {
    const dir = makeTmpDir();
    const tool = new AnsibleTool(createMockProvider());
    const result = await tool.generate({
      playbookName: "setup-nginx",
      targetOS: "ubuntu",
      tasks: "Install nginx",
      outputPath: dir,
      hosts: "webservers",
      becomeRoot: true,
    });
    expect(result.success).toBe(true);
    const data = result.data as { yaml: string };
    expect(data.yaml).toContain("setup-nginx");
    expect(data.yaml).toContain("webservers");
    expect(data.yaml).toContain("Install nginx");
    expect(data.yaml).toContain("Restart nginx");
  });

  it("writes playbook file on execute", async () => {
    const dir = makeTmpDir();
    const tool = new AnsibleTool(createMockProvider());
    await tool.execute({
      playbookName: "setup-nginx",
      targetOS: "ubuntu",
      tasks: "Install nginx",
      outputPath: dir,
      hosts: "all",
      becomeRoot: true,
    });
    const playbookPath = path.join(dir, "setup-nginx.yml");
    expect(fs.existsSync(playbookPath)).toBe(true);
    const content = fs.readFileSync(playbookPath, "utf-8");
    expect(content).toContain("setup-nginx");
    expect(content).toContain("apt");
  });
});
