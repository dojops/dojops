import { DevOpsTool, ToolOutput, VerificationResult } from "@dojops/sdk";
import { ExecutionPolicy, ExecutionResult, AuditEntry, ApprovalDecision } from "./types";
import { ApprovalHandler, AutoApproveHandler, buildPreview } from "./approval";
import { DEFAULT_POLICY, PolicyViolationError } from "./policy";
import { withTimeout } from "./sandbox";

export interface SafeExecutorOptions {
  policy?: Partial<ExecutionPolicy>;
  approvalHandler?: ApprovalHandler;
}

export class SafeExecutor {
  private policy: ExecutionPolicy;
  private approvalHandler: ApprovalHandler;
  private auditLog: AuditEntry[] = [];

  constructor(options: SafeExecutorOptions = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.approvalHandler = options.approvalHandler ?? new AutoApproveHandler();
  }

  async executeTask(taskId: string, tool: DevOpsTool, input: unknown): Promise<ExecutionResult> {
    const startTime = Date.now();
    const filesWritten: string[] = [];

    const validation = tool.validate(input);
    if (!validation.valid) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: `Validation failed: ${validation.error}`,
        filesWritten,
      });
    }

    let generateOutput: ToolOutput;
    try {
      generateOutput = await withTimeout(tool.generate(input as never), this.policy.timeoutMs);
    } catch (err) {
      const status =
        err instanceof PolicyViolationError && err.rule === "timeoutMs"
          ? ("timeout" as const)
          : ("failed" as const);
      return this.buildResult(taskId, tool.name, status, startTime, {
        error: err instanceof Error ? err.message : String(err),
        filesWritten,
      });
    }

    if (!generateOutput.success) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: generateOutput.error,
        output: generateOutput.data,
        filesWritten,
      });
    }

    // Verification step: run after generate, before approval/execute
    let verification: VerificationResult | undefined;
    if (tool.verify && !this.policy.skipVerification) {
      try {
        verification = await withTimeout(tool.verify(generateOutput.data), this.policy.timeoutMs);

        if (!verification.passed) {
          const errorMessages = verification.issues
            .filter((i) => i.severity === "error")
            .map((i) => i.message)
            .join("; ");
          return this.buildResult(taskId, tool.name, "failed", startTime, {
            error: `Verification failed: ${errorMessages}`,
            output: generateOutput.data,
            verification,
            filesWritten,
          });
        }
      } catch {
        // Graceful degradation: verification errors don't block execution
        verification = undefined;
      }
    }

    if (!tool.execute) {
      return this.buildResult(taskId, tool.name, "completed", startTime, {
        output: generateOutput.data,
        approval: "skipped",
        verification,
        filesWritten,
      });
    }

    let approval: ApprovalDecision;

    if (this.policy.requireApproval) {
      const preview = buildPreview(generateOutput, tool.name);
      approval = await this.approvalHandler.requestApproval({
        taskId,
        toolName: tool.name,
        description: `Execute ${tool.name} tool`,
        preview,
      });

      if (approval === "denied") {
        return this.buildResult(taskId, tool.name, "denied", startTime, {
          output: generateOutput.data,
          approval,
          verification,
          filesWritten,
        });
      }
    } else {
      approval = "approved";
    }

    try {
      const executeOutput = await withTimeout(tool.execute(input as never), this.policy.timeoutMs);

      if (!executeOutput.success) {
        return this.buildResult(taskId, tool.name, "failed", startTime, {
          error: executeOutput.error,
          output: executeOutput.data,
          approval,
          verification,
          filesWritten,
        });
      }

      return this.buildResult(taskId, tool.name, "completed", startTime, {
        output: executeOutput.data,
        approval,
        verification,
        filesWritten,
      });
    } catch (err) {
      const status =
        err instanceof PolicyViolationError && err.rule === "timeoutMs"
          ? ("timeout" as const)
          : ("failed" as const);
      return this.buildResult(taskId, tool.name, status, startTime, {
        error: err instanceof Error ? err.message : String(err),
        approval,
        verification,
        filesWritten,
      });
    }
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  private buildResult(
    taskId: string,
    toolName: string,
    status: ExecutionResult["status"],
    startTime: number,
    details: {
      output?: unknown;
      error?: string;
      approval?: ApprovalDecision;
      verification?: VerificationResult;
      filesWritten: string[];
    },
  ): ExecutionResult {
    const durationMs = Date.now() - startTime;
    const approval = details.approval ?? "skipped";

    const auditEntry: AuditEntry = {
      taskId,
      toolName,
      timestamp: new Date().toISOString(),
      policy: this.policy,
      approval,
      status,
      error: details.error,
      verification: details.verification,
      filesWritten: details.filesWritten,
      durationMs,
    };
    this.auditLog.push(auditEntry);

    return {
      taskId,
      status,
      approval,
      output: details.output,
      error: details.error,
      verification: details.verification,
      durationMs,
      auditLog: auditEntry,
    };
  }
}
