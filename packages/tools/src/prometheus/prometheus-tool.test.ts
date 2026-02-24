import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { PrometheusTool } from "./prometheus-tool";
import { PrometheusResponse } from "./schemas";

const mockConfigNoAlerts: PrometheusResponse = {
  global: { scrape_interval: "15s", evaluation_interval: "15s" },
  scrape_configs: [
    {
      job_name: "app",
      static_configs: [{ targets: ["localhost:9090"] }],
    },
  ],
  alertGroups: [],
};

const mockConfigWithAlerts: PrometheusResponse = {
  global: { scrape_interval: "15s", evaluation_interval: "15s" },
  scrape_configs: [
    {
      job_name: "app",
      static_configs: [{ targets: ["localhost:9090"] }],
    },
  ],
  alertGroups: [
    {
      name: "app-alerts",
      rules: [
        {
          alert: "HighErrorRate",
          expr: 'rate(http_requests_total{status="500"}[5m]) > 0.1',
          for: "5m",
          labels: { severity: "critical" },
          annotations: { summary: "High error rate detected" },
        },
      ],
    },
  ],
};

function createMockProvider(config: PrometheusResponse = mockConfigNoAlerts): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(config),
      parsed: config,
    }),
  };
}

describe("PrometheusTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-prometheus-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new PrometheusTool(createMockProvider());
    const result = tool.validate({
      targets: ["localhost:9090"],
      outputPath: "/tmp/prom",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects empty targets", () => {
    const tool = new PrometheusTool(createMockProvider());
    const result = tool.validate({ targets: [], outputPath: "/tmp/prom" });
    expect(result.valid).toBe(false);
  });

  it("generates prometheus YAML", async () => {
    const dir = makeTmpDir();
    const tool = new PrometheusTool(createMockProvider());
    const result = await tool.generate({
      targets: ["localhost:9090"],
      scrapeInterval: "15s",
      outputPath: dir,
    });
    expect(result.success).toBe(true);
    const data = result.data as { prometheusYaml: string; alertsYaml: string | null };
    expect(data.prometheusYaml).toContain("scrape_configs:");
    expect(data.alertsYaml).toBeNull();
  });

  it("writes both files when alerts are present", async () => {
    const dir = makeTmpDir();
    const tool = new PrometheusTool(createMockProvider(mockConfigWithAlerts));
    await tool.execute({
      targets: ["localhost:9090"],
      scrapeInterval: "15s",
      alertRules: "high error rate alert",
      outputPath: dir,
    });
    expect(fs.existsSync(path.join(dir, "prometheus.yml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "alert-rules.yml"))).toBe(true);
    const alertContent = fs.readFileSync(path.join(dir, "alert-rules.yml"), "utf-8");
    expect(alertContent).toContain("HighErrorRate");
  });

  it("writes only prometheus.yml when no alerts", async () => {
    const dir = makeTmpDir();
    const tool = new PrometheusTool(createMockProvider(mockConfigNoAlerts));
    await tool.execute({
      targets: ["localhost:9090"],
      scrapeInterval: "15s",
      outputPath: dir,
    });
    expect(fs.existsSync(path.join(dir, "prometheus.yml"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "alert-rules.yml"))).toBe(false);
  });
});
