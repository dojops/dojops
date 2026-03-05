import { describe, it, expect, vi } from "vitest";
import { BaseTool, ToolOutput, VerificationResult, z } from "@dojops/sdk";
import { SafeExecutor } from "../safe-executor";
import { AutoApproveHandler, AutoDenyHandler, CallbackApprovalHandler } from "../approval";

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

class SlowVerifyTool extends BaseTool<MockInput> {
  name = "slow-verify-tool";
  description = "Verify hangs";
  inputSchema = MockInputSchema;
  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }
  async execute(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { executed: input.value } };
  }
  async verify(): Promise<VerificationResult> {
    await new Promise((r) => setTimeout(r, 5000));
    return { passed: true, tool: "slow-verify", issues: [] };
  }
}

class ThrowingVerifyTool extends BaseTool<MockInput> {
  name = "throwing-verify-tool";
  description = "Verify throws";
  inputSchema = MockInputSchema;
  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }
  async execute(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { executed: input.value } };
  }
  async verify(): Promise<VerificationResult> {
    throw new Error("kubectl not found");
  }
}

class UsageTrackingTool extends BaseTool<MockInput> {
  name = "usage-tool";
  description = "Returns token usage";
  inputSchema = MockInputSchema;
  async generate(input: MockInput): Promise<ToolOutput> {
    return {
      success: true,
      data: { result: input.value },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };
  }
}

class SlowExecuteTool extends BaseTool<MockInput> {
  name = "slow-execute-tool";
  description = "Execute hangs";
  inputSchema = MockInputSchema;
  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }
  async execute(): Promise<ToolOutput> {
    await new Promise((r) => setTimeout(r, 5000));
    return { success: true, data: {} };
  }
}

class FailingExecuteTool extends BaseTool<MockInput> {
  name = "failing-execute-tool";
  description = "Execute fails";
  inputSchema = MockInputSchema;
  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }
  async execute(): Promise<ToolOutput> {
    return { success: false, error: "disk full" };
  }
}

class FileTrackingTool extends BaseTool<MockInput> {
  name = "file-tracking-tool";
  description = "Writes files";
  inputSchema = MockInputSchema;
  async generate(input: MockInput): Promise<ToolOutput> {
    return { success: true, data: { result: input.value } };
  }
  async execute(): Promise<ToolOutput> {
    return {
      success: true,
      data: {},
      filesWritten: ["/tmp/new.yaml"],
      filesModified: ["/tmp/existing.yaml"],
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

  describe("verify-phase timeout", () => {
    it("returns failed status when verify phase exceeds timeout", async () => {
      const executor = new SafeExecutor({
        policy: {
          requireApproval: false,
          skipVerification: false,
          verifyTimeoutMs: 100,
        },
        approvalHandler: new AutoApproveHandler(),
      });

      const result = await executor.executeTask("t1", new SlowVerifyTool(), { value: "hello" });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Verification");
      expect(result.error).toContain("timed out");
      expect(result.verification).toBeDefined();
      expect(result.verification!.passed).toBe(false);
    });
  });

  describe("verify throwing unexpected error", () => {
    it("returns failed with synthetic VerificationResult when verify throws", async () => {
      const executor = new SafeExecutor({
        policy: {
          requireApproval: false,
          skipVerification: false,
        },
        approvalHandler: new AutoApproveHandler(),
      });

      const result = await executor.executeTask("t1", new ThrowingVerifyTool(), { value: "hello" });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Verification threw unexpectedly: kubectl not found");
      expect(result.verification).toBeDefined();
      expect(result.verification!.passed).toBe(false);
      expect(result.verification!.issues).toHaveLength(1);
      expect(result.verification!.issues[0].severity).toBe("error");
      expect(result.verification!.issues[0].message).toContain("kubectl not found");
    });
  });

  describe("token usage accumulation", () => {
    it("accumulates token usage across multiple executeTask calls", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      await executor.executeTask("t1", new UsageTrackingTool(), { value: "first" });
      await executor.executeTask("t2", new UsageTrackingTool(), { value: "second" });
      await executor.executeTask("t3", new UsageTrackingTool(), { value: "third" });

      const usage = executor.getTokenUsage();
      expect(usage.prompt).toBe(300);
      expect(usage.completion).toBe(150);
      expect(usage.total).toBe(450);
    });

    it("returns zeros when tools do not return usage", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      await executor.executeTask("t1", new MockTool(), { value: "no-usage" });
      await executor.executeTask("t2", new GenerateOnlyTool(), { value: "no-usage" });

      const usage = executor.getTokenUsage();
      expect(usage.prompt).toBe(0);
      expect(usage.completion).toBe(0);
      expect(usage.total).toBe(0);
    });
  });

  describe("execute phase timeout", () => {
    it("returns timeout status when execute phase exceeds executeTimeoutMs", async () => {
      const executor = new SafeExecutor({
        policy: {
          requireApproval: false,
          executeTimeoutMs: 100,
        },
        approvalHandler: new AutoApproveHandler(),
      });

      const result = await executor.executeTask("t1", new SlowExecuteTool(), { value: "hello" });

      expect(result.status).toBe("timeout");
      expect(result.error).toContain("timed out");
    });
  });

  describe("execute phase failure", () => {
    it("returns failed status when execute returns success=false", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      const result = await executor.executeTask("t1", new FailingExecuteTool(), { value: "hello" });

      expect(result.status).toBe("failed");
      expect(result.error).toBe("disk full");
      expect(result.approval).toBe("approved");
    });
  });

  describe("metadata enrichment", () => {
    it("enriches audit entry with tool metadata", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      const metadata = {
        toolType: "custom" as const,
        toolSource: "project" as const,
        toolVersion: "1.2.3",
        toolHash: "sha256:abc123",
      };

      await executor.executeTask("t1", new MockTool(), { value: "hello" }, metadata);

      const log = executor.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].toolType).toBe("custom");
      expect(log[0].toolSource).toBe("project");
      expect(log[0].toolVersion).toBe("1.2.3");
      expect(log[0].toolHash).toBe("sha256:abc123");
    });
  });

  describe("files tracking", () => {
    it("captures filesWritten and filesModified in the audit entry", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      const result = await executor.executeTask("t1", new FileTrackingTool(), { value: "hello" });

      expect(result.status).toBe("completed");

      const log = executor.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0].filesWritten).toEqual(["/tmp/new.yaml"]);
      expect(log[0].filesModified).toEqual(["/tmp/existing.yaml"]);
    });
  });

  describe("T-10: concurrent execute() calls", () => {
    it("both concurrent executeTask calls complete without corruption", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      const [result1, result2] = await Promise.all([
        executor.executeTask("t1", new MockTool(), { value: "first" }),
        executor.executeTask("t2", new MockTool(), { value: "second" }),
      ]);

      expect(result1.status).toBe("completed");
      expect(result2.status).toBe("completed");
      expect(result1.output).toEqual({ executed: "first" });
      expect(result2.output).toEqual({ executed: "second" });

      const log = executor.getAuditLog();
      expect(log).toHaveLength(2);
      const taskIds = log.map((e) => e.taskId).sort((a, b) => a.localeCompare(b));
      expect(taskIds).toEqual(["t1", "t2"]);
    });

    it("concurrent execute() calls to the same tool produce independent results", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      const results = await Promise.all([
        executor.executeTask("concurrent-1", new FileTrackingTool(), { value: "a" }),
        executor.executeTask("concurrent-2", new FileTrackingTool(), { value: "b" }),
        executor.executeTask("concurrent-3", new FileTrackingTool(), { value: "c" }),
      ]);

      // All should complete
      for (const result of results) {
        expect(result.status).toBe("completed");
      }

      const log = executor.getAuditLog();
      expect(log).toHaveLength(3);

      // Each audit entry should have its own file tracking
      for (const entry of log) {
        expect(entry.filesWritten).toEqual(["/tmp/new.yaml"]);
        expect(entry.filesModified).toEqual(["/tmp/existing.yaml"]);
      }
    });

    it("concurrent mix of passing and failing tools does not corrupt state", async () => {
      const executor = new SafeExecutor({
        policy: { requireApproval: false },
        approvalHandler: new AutoApproveHandler(),
      });

      const [success, failure] = await Promise.all([
        executor.executeTask("pass-task", new MockTool(), { value: "ok" }),
        executor.executeTask("fail-task", new FailingTool(), { value: "bad" }),
      ]);

      expect(success.status).toBe("completed");
      expect(failure.status).toBe("failed");

      const log = executor.getAuditLog();
      expect(log).toHaveLength(2);

      const successLog = log.find((e) => e.taskId === "pass-task");
      const failLog = log.find((e) => e.taskId === "fail-task");
      expect(successLog!.status).toBe("completed");
      expect(failLog!.status).toBe("failed");
    });
  });

  describe("T-13: SafeExecutor policy + DevOps allowlist interaction", () => {
    it("blocks non-DevOps file write when enforceDevOpsAllowlist is true", async () => {
      const executor = new SafeExecutor({
        policy: {
          requireApproval: false,
          allowWrite: true,
          enforceDevOpsAllowlist: true,
          allowedWritePaths: [],
          deniedWritePaths: [],
        },
        approvalHandler: new AutoApproveHandler(),
      });

      // Create a tool that writes to a non-DevOps path
      class NonDevOpsWriteTool extends BaseTool<MockInput> {
        name = "non-devops-write-tool";
        description = "Writes to non-DevOps file";
        inputSchema = MockInputSchema;
        async generate(input: MockInput): Promise<ToolOutput> {
          return { success: true, data: { result: input.value } };
        }
        async execute(): Promise<ToolOutput> {
          return {
            success: true,
            data: {},
            filesWritten: ["src/index.ts"],
            filesModified: [],
          };
        }
      }

      const result = await executor.executeTask("t-allowlist", new NonDevOpsWriteTool(), {
        value: "test",
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Policy violation");
      expect(result.error).toContain("not a recognized DevOps file");
    });

    it("allows any file write when enforceDevOpsAllowlist is false", async () => {
      const executor = new SafeExecutor({
        policy: {
          requireApproval: false,
          allowWrite: true,
          enforceDevOpsAllowlist: false,
          allowedWritePaths: [],
          deniedWritePaths: [],
        },
        approvalHandler: new AutoApproveHandler(),
      });

      class AnyFileWriteTool extends BaseTool<MockInput> {
        name = "any-file-write-tool";
        description = "Writes to arbitrary file";
        inputSchema = MockInputSchema;
        async generate(input: MockInput): Promise<ToolOutput> {
          return { success: true, data: { result: input.value } };
        }
        async execute(): Promise<ToolOutput> {
          return {
            success: true,
            data: {},
            filesWritten: ["src/index.ts"],
            filesModified: ["package.json"],
          };
        }
      }

      const result = await executor.executeTask("t-no-allowlist", new AnyFileWriteTool(), {
        value: "test",
      });

      expect(result.status).toBe("completed");
    });

    it("allows DevOps file writes when enforceDevOpsAllowlist is true", async () => {
      const executor = new SafeExecutor({
        policy: {
          requireApproval: false,
          allowWrite: true,
          enforceDevOpsAllowlist: true,
          allowedWritePaths: [],
          deniedWritePaths: [],
        },
        approvalHandler: new AutoApproveHandler(),
      });

      class DevOpsWriteTool extends BaseTool<MockInput> {
        name = "devops-write-tool";
        description = "Writes to DevOps files";
        inputSchema = MockInputSchema;
        async generate(input: MockInput): Promise<ToolOutput> {
          return { success: true, data: { result: input.value } };
        }
        async execute(): Promise<ToolOutput> {
          return {
            success: true,
            data: {},
            filesWritten: ["Dockerfile", "main.tf"],
            filesModified: [],
          };
        }
      }

      const result = await executor.executeTask("t-devops-ok", new DevOpsWriteTool(), {
        value: "test",
      });

      expect(result.status).toBe("completed");
    });
  });
});
