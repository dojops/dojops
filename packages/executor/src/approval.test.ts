import { describe, it, expect, vi } from "vitest";
import {
  AutoApproveHandler,
  AutoDenyHandler,
  CallbackApprovalHandler,
  buildPreview,
} from "./approval";
import { ApprovalRequest, ExecutionPreview } from "./types";

const mockRequest: ApprovalRequest = {
  taskId: "t1",
  toolName: "test-tool",
  description: "Test execution",
  preview: { filesCreated: [], filesModified: [], summary: "test" },
};

describe("AutoApproveHandler", () => {
  it("always returns approved", async () => {
    const handler = new AutoApproveHandler();
    const result = await handler.requestApproval(mockRequest);
    expect(result).toBe("approved");
  });
});

describe("AutoDenyHandler", () => {
  it("always returns denied", async () => {
    const handler = new AutoDenyHandler();
    const result = await handler.requestApproval(mockRequest);
    expect(result).toBe("denied");
  });
});

describe("CallbackApprovalHandler", () => {
  it("delegates to callback function", async () => {
    const callback = vi.fn().mockResolvedValue("approved");
    const handler = new CallbackApprovalHandler(callback);
    const result = await handler.requestApproval(mockRequest);
    expect(result).toBe("approved");
    expect(callback).toHaveBeenCalledWith(mockRequest);
  });
});

describe("buildPreview", () => {
  it("generates preview for YAML output", () => {
    const output = { success: true, data: { yaml: "name: CI\n" } };
    const preview: ExecutionPreview = buildPreview(output, "github-actions");
    expect(preview.summary).toContain("github-actions");
    expect(preview.summary).toContain("YAML");
  });

  it("generates preview for HCL output", () => {
    const output = { success: true, data: { hcl: 'provider "aws" {}' } };
    const preview = buildPreview(output, "terraform");
    expect(preview.summary).toContain("HCL");
  });

  it("generates preview for chart output", () => {
    const output = {
      success: true,
      data: {
        chartYaml: "name: myapp",
        valuesYaml: "replicas: 1",
        templates: { deployment: "...", service: "..." },
      },
    };
    const preview = buildPreview(output, "helm");
    expect(preview.filesCreated).toContain("Chart.yaml");
    expect(preview.filesCreated).toContain("values.yaml");
    expect(preview.filesCreated).toContain("templates/deployment");
    expect(preview.filesCreated).toContain("templates/service");
  });

  it("handles empty data gracefully", () => {
    const output = { success: true };
    const preview = buildPreview(output, "test");
    expect(preview.summary).toContain("test");
    expect(preview.filesCreated).toHaveLength(0);
  });
});
