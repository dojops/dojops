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

describe("InfraDiffAnalyzer edge cases", () => {
  it("returns analysis with empty diff input", async () => {
    const emptyDiffAnalysis: InfraDiffAnalysis = {
      summary: "No changes detected",
      changes: [],
      riskLevel: "low",
      riskFactors: [],
      costImpact: { direction: "unchanged", details: "No resources modified" },
      securityImpact: [],
      rollbackComplexity: "trivial",
      recommendations: ["No action needed"],
      confidence: 1.0,
    };
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(emptyDiffAnalysis),
        parsed: emptyDiffAnalysis,
      }),
    };
    const analyzer = new InfraDiffAnalyzer(provider);

    const result = await analyzer.analyze("");

    // Even with empty input, the provider's generate is called
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("No changes detected");
    expect(result.changes).toHaveLength(0);
    expect(result.riskLevel).toBe("low");
  });

  it("handles compare with before and after using structured prompts", async () => {
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify(highRiskAnalysis),
        parsed: highRiskAnalysis,
      }),
    };
    const analyzer = new InfraDiffAnalyzer(provider);

    const before = 'resource "aws_instance" "web" { instance_type = "t2.micro" }';
    const after = 'resource "aws_instance" "web" { instance_type = "t3.xlarge" }';

    const result = await analyzer.compare(before, after);

    // Verify the prompt contains both BEFORE and AFTER sections
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("BEFORE"),
      }),
    );
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("AFTER"),
      }),
    );
    // Verify the wrapped content includes the actual before/after configs
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("t2.micro"),
      }),
    );
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("t3.xlarge"),
      }),
    );
    // Verify the result is properly returned
    expect(result.riskLevel).toBe("high");
    expect(result.changes).toHaveLength(2);
    expect(result.rollbackComplexity).toBe("complex");
  });
});
