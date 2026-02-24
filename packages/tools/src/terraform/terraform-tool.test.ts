import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LLMProvider } from "@dojops/core";
import { TerraformTool } from "./terraform-tool";
import { TerraformConfig } from "./schemas";

const mockConfig: TerraformConfig = {
  provider: { name: "aws", region: "us-east-1", config: {} },
  variables: [{ name: "region", type: "string", description: "AWS region", default: "us-east-1" }],
  resources: [
    {
      type: "aws_s3_bucket",
      name: "main",
      config: { bucket: "my-bucket", acl: "private" },
    },
  ],
  outputs: [{ name: "bucket_arn", value: "aws_s3_bucket.main.arn", description: "Bucket ARN" }],
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

describe("TerraformTool", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-tf-tool-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("validates correct input", () => {
    const tool = new TerraformTool(createMockProvider());
    const result = tool.validate({
      projectPath: "/some/path",
      provider: "aws",
      resources: "S3 bucket",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects invalid provider", () => {
    const tool = new TerraformTool(createMockProvider());
    const result = tool.validate({
      projectPath: "/some/path",
      provider: "invalid",
      resources: "something",
    });
    expect(result.valid).toBe(false);
  });

  it("rejects input without required fields", () => {
    const tool = new TerraformTool(createMockProvider());
    const result = tool.validate({});
    expect(result.valid).toBe(false);
  });

  it("generates HCL from LLM response", async () => {
    const dir = makeTmpDir();
    const tool = new TerraformTool(createMockProvider());
    const result = await tool.generate({
      projectPath: dir,
      provider: "aws",
      resources: "S3 bucket",
      backendType: "local",
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("hcl");
    const data = result.data as { hcl: string };
    expect(data.hcl).toContain("aws_s3_bucket");
    expect(data.hcl).toContain("hashicorp/aws");
  });

  it("writes main.tf on execute", async () => {
    const dir = makeTmpDir();
    const tool = new TerraformTool(createMockProvider());
    await tool.execute({
      projectPath: dir,
      provider: "aws",
      resources: "S3 bucket",
      backendType: "local",
    });
    const mainTf = path.join(dir, "main.tf");
    expect(fs.existsSync(mainTf)).toBe(true);
    const content = fs.readFileSync(mainTf, "utf-8");
    expect(content).toContain("aws_s3_bucket");
  });
});
