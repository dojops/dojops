import { describe, it, expect, vi } from "vitest";
import { BaseTool, ToolOutput, VerificationResult, z } from "@dojops/sdk";
import { SafeExecutor } from "./safe-executor";
import { AutoApproveHandler, AutoDenyHandler, CallbackApprovalHandler } from "./approval";

const MockInputSchema = z.object({ value: z.string() });
type MockInput = z.infer<typeof MockInputSchema>;

class MockTool extends BaseTool<MockInput> {
  name = "mock-tool";
  description = "A mock tool";
  inputSchema = MockInputSchema;

  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }

  async execute(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { executed: input.value } };
  }
}

class GenerateOnlyTool extends BaseTool<MockInput> {
  name = "generate-only";
  description = "A tool without execute";
  inputSchema = MockInputSchema;

  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }
}

class FailingTool extends BaseTool<MockInput> {
  name = "failing-tool";
  description = "Always fails generate";
  inputSchema = MockInputSchema;

  async generate(): Promise<ToolOutput> {
    return { success: false, error: "generation failed" };
  }
}

class SlowTool extends BaseTool<MockInput> {
  name = "slow-tool";
  description = "Exceeds timeout";
  inputSchema = MockInputSchema;

  async generate(): Promise<ToolOutput> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { success: true, data: {} };
  }
}

class VerifiableTool extends BaseTool<MockInput> {
  name = "verifiable-tool";
  description = "A tool with passing verify";
  inputSchema = MockInputSchema;

  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }

  async execute(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { executed: input.value } };
  }

  async verify(): Promise<VerificationResult> {
    return { passed: true, tool: "test-verify", issues: [] };
  }
}

class FailingVerifyTool extends BaseTool<MockInput> {
  name = "failing-verify-tool";
  description = "A tool with failing verify";
  inputSchema = MockInputSchema;

  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }

  async execute(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { executed: input.value } };
  }

  async verify(): Promise<VerificationResult> {
    return {
      passed: false,
      tool: "test-verify",
      issues: [{ severity: "error", message: "Invalid config" }],
    };
  }
}

describe("SafeExecutor", () => {
  it("executes a tool through generate and execute with approval", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: true },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new MockTool(), { value: "hello" });

    expect(result.status).toBe("completed");
    expect(result.approval).toBe("approved");
    expect(result.output).toEqual({ executed: "hello" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("denies execution when approval handler denies", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: true },
      approvalHandler: new AutoDenyHandler(),
    });

    const result = await executor.executeTask("t1", new MockTool(), { value: "hello" });

    expect(result.status).toBe("denied");
    expect(result.approval).toBe("denied");
  });

  it("skips approval when requireApproval is false", async () => {
    const callback = vi.fn().mockResolvedValue("approved");
    const executor = new SafeExecutor({
      policy: { requireApproval: false },
      approvalHandler: new CallbackApprovalHandler(callback),
    });

    const result = await executor.executeTask("t1", new MockTool(), { value: "hello" });

    expect(result.status).toBe("completed");
    expect(result.approval).toBe("approved");
    expect(callback).not.toHaveBeenCalled();
  });

  it("skips execute phase for tools without execute method", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: true },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new GenerateOnlyTool(), { value: "hello" });

    expect(result.status).toBe("completed");
    expect(result.approval).toBe("skipped");
    expect(result.output).toEqual({ result: "hello" });
  });

  it("returns failed when generate fails", async () => {
    const executor = new SafeExecutor({
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new FailingTool(), { value: "hello" });

    expect(result.status).toBe("failed");
    expect(result.error).toBe("generation failed");
  });

  it("returns failed when validation fails", async () => {
    const executor = new SafeExecutor({
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new MockTool(), { value: 123 });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Validation failed");
  });

  it("returns timeout when tool exceeds timeout", async () => {
    const executor = new SafeExecutor({
      policy: { timeoutMs: 100 },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new SlowTool(), { value: "hello" });

    expect(result.status).toBe("timeout");
    expect(result.error).toContain("timed out");
  });

  it("maintains an audit log of all executions", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: false },
      approvalHandler: new AutoApproveHandler(),
    });

    await executor.executeTask("t1", new MockTool(), { value: "first" });
    await executor.executeTask("t2", new FailingTool(), { value: "second" });

    const log = executor.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0].taskId).toBe("t1");
    expect(log[0].status).toBe("completed");
    expect(log[1].taskId).toBe("t2");
    expect(log[1].status).toBe("failed");
  });

  it("passes approval request with preview to handler", async () => {
    const callback = vi.fn().mockResolvedValue("approved");
    const executor = new SafeExecutor({
      policy: { requireApproval: true },
      approvalHandler: new CallbackApprovalHandler(callback),
    });

    await executor.executeTask("t1", new MockTool(), { value: "hello" });

    expect(callback).toHaveBeenCalledTimes(1);
    const request = callback.mock.calls[0][0];
    expect(request.taskId).toBe("t1");
    expect(request.toolName).toBe("mock-tool");
    expect(request.preview).toBeDefined();
    expect(request.preview.summary).toContain("mock-tool");
  });

  it("runs verification and continues when it passes", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: false, skipVerification: false },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new VerifiableTool(), { value: "hello" });

    expect(result.status).toBe("completed");
    expect(result.verification).toBeDefined();
    expect(result.verification!.passed).toBe(true);
    expect(result.output).toEqual({ executed: "hello" });
  });

  it("returns failed when verification fails", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: false, skipVerification: false },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new FailingVerifyTool(), { value: "hello" });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Verification failed");
    expect(result.verification).toBeDefined();
    expect(result.verification!.passed).toBe(false);
  });

  it("skips verification for tools without verify method", async () => {
    const executor = new SafeExecutor({
      policy: { requireApproval: false, skipVerification: false },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new MockTool(), { value: "hello" });

    expect(result.status).toBe("completed");
    expect(result.verification).toBeUndefined();
  });

  it("skips verification when skipVerification is true", async () => {
    const verifySpy = vi.spyOn(VerifiableTool.prototype, "verify");
    const executor = new SafeExecutor({
      policy: { requireApproval: false, skipVerification: true },
      approvalHandler: new AutoApproveHandler(),
    });

    const result = await executor.executeTask("t1", new VerifiableTool(), { value: "hello" });

    expect(result.status).toBe("completed");
    expect(verifySpy).not.toHaveBeenCalled();
    expect(result.verification).toBeUndefined();
    verifySpy.mockRestore();
  });
});
