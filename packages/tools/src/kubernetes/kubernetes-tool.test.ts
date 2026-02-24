import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { KubernetesTool } from "./kubernetes-tool";
import { KubernetesManifest } from "./schemas";

const mockManifest: KubernetesManifest = {
  deployment: {
    replicas: 3,
    containers: [
      {
        name: "web",
        image: "nginx:latest",
        ports: [{ containerPort: 80, protocol: "TCP" }],
        env: [],
      },
    ],
    labels: {},
  },
  service: {
    type: "ClusterIP",
    ports: [{ port: 80, targetPort: 80, protocol: "TCP" }],
  },
};

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(mockManifest),
      parsed: mockManifest,
    }),
  };
}

describe("KubernetesTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-k8s-tool-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new KubernetesTool(createMockProvider());
    const result = tool.validate({
      appName: "web",
      image: "nginx:latest",
      port: 80,
      outputPath: "/tmp",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects input without required fields", () => {
    const tool = new KubernetesTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("rejects invalid port", () => {
    const tool = new KubernetesTool(createMockProvider());
    const result = tool.validate({
      appName: "web",
      image: "nginx:latest",
      port: -1,
      outputPath: "/tmp",
    });
    expect(result.valid).toBe(false);
  });

  it("generates Kubernetes YAML with deployment and service", async () => {
    const dir = makeTmpDir();
    const tool = new KubernetesTool(createMockProvider());
    const result = await tool.generate({
      appName: "web",
      image: "nginx:latest",
      port: 80,
      replicas: 3,
      namespace: "default",
      outputPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data as { yaml: string };
    expect(data.yaml).toContain("Deployment");
    expect(data.yaml).toContain("Service");
    expect(data.yaml).toContain("---");
  });

  it("writes manifest file on execute", async () => {
    const dir = makeTmpDir();
    const tool = new KubernetesTool(createMockProvider());
    await tool.execute({
      appName: "web",
      image: "nginx:latest",
      port: 80,
      replicas: 3,
      namespace: "default",
      outputPath: dir,
    });
    const manifestPath = path.join(dir, "web.yaml");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const content = fs.readFileSync(manifestPath, "utf-8");
    expect(content).toContain("Deployment");
    expect(content).toContain("Service");
  });
});
