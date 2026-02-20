import { describe, it, expect, vi } from "vitest";
import { InfraDiffAnalyzer, InfraDiffAnalysis, InfraDiffAnalysisSchema } from "./infra-diff";
import { LLMProvider, LLMResponse } from "../llm/provider";

const highRiskAnalysis: InfraDiffAnalysis = {
  summary: "Replacing RDS instance will cause downtime",
  changes: [
    {
      resource: "aws_db_instance.main",
      action: "replace",
      attribute: "engine_version",
      oldValue: "14.3",
      newValue: "16.1",
    },
    {
      resource: "aws_security_group_rule.db",
      action: "update",
      attribute: "cidr_blocks",
      oldValue: '["10.0.0.0/16"]',
      newValue: '["10.0.0.0/8"]',
    },
  ],
  riskLevel: "high",
  riskFactors: [
    "RDS instance replacement causes downtime",
    "Security group rule widens network access",
  ],
  costImpact: {
    direction: "increase",
    details: "PostgreSQL 16 may use more IOPS",
  },
  securityImpact: ["Widened CIDR range from /16 to /8 increases attack surface"],
  rollbackComplexity: "complex",
  recommendations: [
    "Schedule maintenance window for RDS replacement",
    "Review widened security group CIDR",
    "Take a database snapshot before applying",
  ],
  confidence: 0.9,
};

const lowRiskAnalysis: InfraDiffAnalysis = {
  summary: "Adding tags to existing resources",
  changes: [
    {
      resource: "aws_s3_bucket.assets",
      action: "update",
      attribute: "tags",
    },
  ],
  riskLevel: "low",
  riskFactors: [],
  costImpact: { direction: "unchanged", details: "Tags do not affect cost" },
  securityImpact: [],
  rollbackComplexity: "trivial",
  recommendations: ["Safe to apply"],
  confidence: 0.95,
};

function mockProvider(analysis: InfraDiffAnalysis): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(analysis),
      parsed: analysis,
    } satisfies LLMResponse),
  };
}

describe("InfraDiffAnalyzer", () => {
  it("analyzes a high-risk infrastructure diff", async () => {
    const provider = mockProvider(highRiskAnalysis);
    const analyzer = new InfraDiffAnalyzer(provider);

    const result = await analyzer.analyze(
      "# aws_db_instance.main must be replaced\n-/+ engine_version: 14.3 -> 16.1",
    );

    expect(result.riskLevel).toBe("high");
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].action).toBe("replace");
    expect(result.securityImpact.length).toBeGreaterThan(0);
    expect(result.rollbackComplexity).toBe("complex");
  });

  it("analyzes a low-risk diff", async () => {
    const provider = mockProvider(lowRiskAnalysis);
    const analyzer = new InfraDiffAnalyzer(provider);

    const result = await analyzer.analyze(
      "~ aws_s3_bucket.assets: tags.Environment: '' -> 'production'",
    );

    expect(result.riskLevel).toBe("low");
    expect(result.riskFactors).toHaveLength(0);
    expect(result.costImpact.direction).toBe("unchanged");
    expect(result.rollbackComplexity).toBe("trivial");
  });

  it("passes schema for structured output", async () => {
    const provider = mockProvider(lowRiskAnalysis);
    const analyzer = new InfraDiffAnalyzer(provider);

    await analyzer.analyze("some diff");

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: InfraDiffAnalysisSchema,
      }),
    );
  });

  it("compares before/after configurations", async () => {
    const provider = mockProvider(highRiskAnalysis);
    const analyzer = new InfraDiffAnalyzer(provider);

    const result = await analyzer.compare(
      'resource "aws_db_instance" "main" { engine_version = "14.3" }',
      'resource "aws_db_instance" "main" { engine_version = "16.1" }',
    );

    expect(result.changes.length).toBeGreaterThan(0);
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("BEFORE"),
      }),
    );
  });

  it("falls back to parsing content when parsed is not set", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(lowRiskAnalysis),
      }),
    };
    const analyzer = new InfraDiffAnalyzer(provider);

    const result = await analyzer.analyze("diff");

    expect(result.riskLevel).toBe("low");
    expect(result.summary).toBe("Adding tags to existing resources");
  });
});
