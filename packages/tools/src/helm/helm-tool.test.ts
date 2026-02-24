import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { HelmTool } from "./helm-tool";
import { HelmChartResponse } from "./schemas";

const mockChartResponse: HelmChartResponse = {
  values: {
    replicaCount: 2,
    image: {
      repository: "myapp",
      tag: "latest",
      pullPolicy: "IfNotPresent",
    },
    service: {
      type: "ClusterIP",
      port: 8080,
    },
    resources: {
      requests: { cpu: "100m", memory: "128Mi" },
      limits: { cpu: "200m", memory: "256Mi" },
    },
    env: [],
  },
  notes: "Chart generated successfully",
};

function createMockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(mockChartResponse),
      parsed: mockChartResponse,
    }),
  };
}

describe("HelmTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-helm-tool-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new HelmTool(createMockProvider());
    const result = tool.validate({
      chartName: "myapp",
      image: "myapp:latest",
      port: 8080,
      outputPath: "/tmp",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects input without required fields", () => {
    const tool = new HelmTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("generates chart files from LLM response", async () => {
    const dir = makeTmpDir();
    const tool = new HelmTool(createMockProvider());
    const result = await tool.generate({
      chartName: "myapp",
      appVersion: "1.0.0",
      description: "My app chart",
      outputPath: dir,
      image: "myapp:latest",
      port: 8080,
    });
    expect(result.success).toBe(true);
    const data = result.data as {
      chartYaml: string;
      valuesYaml: string;
      templates: { deployment: string; service: string };
    };
    expect(data.chartYaml).toContain("myapp");
    expect(data.valuesYaml).toContain("replicaCount");
    expect(data.templates.deployment).toContain("Deployment");
    expect(data.templates.service).toContain("Service");
  });

  it("writes full chart directory on execute", async () => {
    const dir = makeTmpDir();
    const tool = new HelmTool(createMockProvider());
    await tool.execute({
      chartName: "myapp",
      appVersion: "1.0.0",
      description: "My app chart",
      outputPath: dir,
      image: "myapp:latest",
      port: 8080,
    });
    const chartDir = path.join(dir, "myapp");
    expect(fs.existsSync(path.join(chartDir, "Chart.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, "values.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, "templates", "deployment.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, "templates", "service.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(chartDir, "templates", "_helpers.tpl"))).toBe(true);
  });

  it("includes chart metadata in Chart.yaml", async () => {
    const dir = makeTmpDir();
    const tool = new HelmTool(createMockProvider());
    await tool.execute({
      chartName: "myapp",
      appVersion: "2.0.0",
      description: "Custom description",
      outputPath: dir,
      image: "myapp:latest",
      port: 8080,
    });
    const chartContent = fs.readFileSync(path.join(dir, "myapp", "Chart.yaml"), "utf-8");
    expect(chartContent).toContain("myapp");
    expect(chartContent).toContain("2.0.0");
    expect(chartContent).toContain("Custom description");
  });
});
