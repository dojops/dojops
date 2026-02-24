import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { NginxTool } from "./nginx-tool";
import { NginxConfig } from "./schemas";

const mockConfig: NginxConfig = {
  upstreams: [
    {
      name: "backend",
      servers: ["127.0.0.1:3000", "127.0.0.1:3001"],
      loadBalancing: "round-robin",
    },
  ],
  servers: [
    {
      listen: 80,
      server_name: "example.com",
      locations: [
        {
          path: "/",
          proxy_pass: "http://backend",
          extra_directives: {
            proxy_set_header_Host: "$host",
            proxy_set_header_X_Real_IP: "$remote_addr",
          },
        },
      ],
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

describe("NginxTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-nginx-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new NginxTool(createMockProvider());
    const result = tool.validate({
      serverName: "example.com",
      upstreams: [{ name: "backend", servers: ["127.0.0.1:3000"] }],
      outputPath: "/tmp/nginx",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects empty upstreams", () => {
    const tool = new NginxTool(createMockProvider());
    const result = tool.validate({
      serverName: "example.com",
      upstreams: [],
      outputPath: "/tmp/nginx",
    });
    expect(result.valid).toBe(false);
  });

  it("generates nginx config with upstream and server blocks", async () => {
    const dir = makeTmpDir();
    const tool = new NginxTool(createMockProvider());
    const result = await tool.generate({
      serverName: "example.com",
      upstreams: [{ name: "backend", servers: ["127.0.0.1:3000"] }],
      sslEnabled: false,
      outputPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data as { nginxConf: string };
    expect(data.nginxConf).toContain("upstream backend");
    expect(data.nginxConf).toContain("server {");
    expect(data.nginxConf).toContain("proxy_pass http://backend");
  });

  it("writes nginx.conf on execute", async () => {
    const dir = makeTmpDir();
    const tool = new NginxTool(createMockProvider());
    await tool.execute({
      serverName: "example.com",
      upstreams: [{ name: "backend", servers: ["127.0.0.1:3000"] }],
      sslEnabled: false,
      outputPath: dir,
    });
    const confPath = path.join(dir, "nginx.conf");
    expect(fs.existsSync(confPath)).toBe(true);
    const content = fs.readFileSync(confPath, "utf-8");
    expect(content).toContain("upstream");
    expect(content).toContain("server");
  });

  it("rejects missing required fields", () => {
    const tool = new NginxTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });
});
