import { describe, it, expect, vi } from "vitest";
import { LLMProvider } from "@dojops/core";
import { generateTerraformConfig, configToHcl } from "./generator";
import { TerraformConfig } from "./schemas";

const mockConfig: TerraformConfig = {
  provider: { name: "aws", region: "us-east-1", config: {} },
  resources: [{ type: "aws_s3_bucket", name: "main", config: { bucket: "my-bucket" } }],
  variables: [{ name: "region", type: "string", description: "AWS region" }],
  outputs: [{ name: "bucket_arn", value: "aws_s3_bucket.main.arn", description: "Bucket ARN" }],
};

function mockProvider(): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(mockConfig),
      parsed: mockConfig,
    }),
  };
}

describe("generateTerraformConfig", () => {
  it("calls provider with schema and returns parsed config", async () => {
    const provider = mockProvider();
    const result = await generateTerraformConfig("aws", "S3 bucket", "local", provider);

    expect(result).toEqual(mockConfig);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.schema).toBeDefined();
    expect(call.prompt).toContain("S3 bucket");
  });
});

describe("configToHcl", () => {
  it("generates valid HCL structure", () => {
    const hcl = configToHcl(mockConfig);
    expect(hcl).toContain('provider "aws"');
    expect(hcl).toContain('region = "us-east-1"');
    expect(hcl).toContain('resource "aws_s3_bucket" "main"');
    expect(hcl).toContain('variable "region"');
    expect(hcl).toContain('output "bucket_arn"');
  });

  it("includes backend when present", () => {
    const config: TerraformConfig = {
      ...mockConfig,
      backend: { type: "s3", config: { bucket: "tf-state" } },
    };
    const hcl = configToHcl(config);
    expect(hcl).toContain('backend "s3"');
    expect(hcl).toContain("tf-state");
  });

  it("handles config without backend", () => {
    const hcl = configToHcl(mockConfig);
    expect(hcl).not.toContain("backend");
  });

  it("maps known providers to hashicorp source", () => {
    const hcl = configToHcl(mockConfig);
    expect(hcl).toContain("hashicorp/aws");
  });
});
