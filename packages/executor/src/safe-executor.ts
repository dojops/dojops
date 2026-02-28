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
  private tokenUsage = { prompt: 0, completion: 0, total: 0 };

  constructor(options: SafeExecutorOptions = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.approvalHandler = options.approvalHandler ?? new AutoApproveHandler();
  }

  async executeTask(
    taskId: string,
    tool: DevOpsTool,
    input: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const filesWritten: string[] = [];
    const filesModified: string[] = [];
    const meta = metadata;

    const validation = tool.validate(input);
    if (!validation.valid) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: `Validation failed: ${validation.error}`,
        filesWritten,
        metadata: meta,
      });
    }

    let generateOutput: ToolOutput;
    try {
      generateOutput = await withTimeout(
        tool.generate(input as never),
        this.policy.generateTimeoutMs ?? this.policy.timeoutMs,
      );
    } catch (err) {
      const isTimeout = err instanceof PolicyViolationError && err.rule === "timeoutMs";
      const status = isTimeout ? ("timeout" as const) : ("failed" as const);
      const error = isTimeout
        ? "Generate phase timed out"
        : err instanceof Error
          ? err.message
          : String(err);
      return this.buildResult(taskId, tool.name, status, startTime, {
        error,
        filesWritten,
        metadata: meta,
      });
    }

    // Accumulate token usage from generate output
    if (generateOutput.usage) {
      this.tokenUsage.prompt += generateOutput.usage.promptTokens;
      this.tokenUsage.completion += generateOutput.usage.completionTokens;
      this.tokenUsage.total += generateOutput.usage.totalTokens;
    }

    if (!generateOutput.success) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: generateOutput.error,
        output: generateOutput.data,
        filesWritten,
        usage: generateOutput.usage,
        metadata: meta,
      });
    }

    // Verification step: run after generate, before approval/execute
    let verification: VerificationResult | undefined;
    if (tool.verify && !this.policy.skipVerification) {
      try {
        verification = await withTimeout(
          tool.verify(generateOutput.data),
          this.policy.verifyTimeoutMs ?? this.policy.timeoutMs,
          "Verify phase timed out",
        );

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
            usage: generateOutput.usage,
            metadata: meta,
          });
        }
      } catch (verifyErr) {
        verification = {
          passed: false,
          tool: tool.name,
          issues: [
            {
              severity: "error",
              message: `Verification threw unexpectedly: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`,
            },
          ],
        };
        return this.buildResult(taskId, tool.name, "failed", startTime, {
          error: `Verification error: ${verification.issues[0].message}`,
          output: generateOutput.data,
          verification,
          filesWritten,
          usage: generateOutput.usage,
          metadata: meta,
        });
      }
    }

    if (!tool.execute) {
      return this.buildResult(taskId, tool.name, "completed", startTime, {
        output: generateOutput.data,
        approval: "skipped",
        verification,
        filesWritten,
        usage: generateOutput.usage,
        metadata: meta,
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
          usage: generateOutput.usage,
          metadata: meta,
        });
      }
    } else {
      approval = "approved";
    }

    try {
      const executeOutput = await withTimeout(
        tool.execute(input as never),
        this.policy.executeTimeoutMs ?? this.policy.timeoutMs,
        "Execute phase timed out",
      );

      // Extract file metadata from tool output
      if (executeOutput.filesWritten) filesWritten.push(...executeOutput.filesWritten);
      if (executeOutput.filesModified) filesModified.push(...executeOutput.filesModified);

      if (!executeOutput.success) {
        return this.buildResult(taskId, tool.name, "failed", startTime, {
          error: executeOutput.error,
          output: executeOutput.data,
          approval,
          verification,
          filesWritten,
          filesModified,
          usage: generateOutput.usage,
          metadata: meta,
        });
      }

      return this.buildResult(taskId, tool.name, "completed", startTime, {
        output: executeOutput.data,
        approval,
        verification,
        filesWritten,
        filesModified,
        usage: generateOutput.usage,
        metadata: meta,
      });
    } catch (err) {
      const isTimeout = err instanceof PolicyViolationError && err.rule === "timeoutMs";
      const status = isTimeout ? ("timeout" as const) : ("failed" as const);
      const error = isTimeout
        ? "Execute phase timed out"
        : err instanceof Error
          ? err.message
          : String(err);
      return this.buildResult(taskId, tool.name, status, startTime, {
        error,
        approval,
        verification,
        filesWritten,
        usage: generateOutput.usage,
        metadata: meta,
      });
    }
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  getTokenUsage(): { prompt: number; completion: number; total: number } {
    return { ...this.tokenUsage };
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
      filesModified?: string[];
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      metadata?: Record<string, unknown>;
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
      filesModified: details.filesModified ?? [],
      durationMs,
    };

    // Enrich audit entry with token usage if available
    if (details.usage) {
      auditEntry.usage = details.usage;
    }

    // Enrich audit entry with tool metadata if provided
    const meta = details.metadata;
    if (meta) {
      if (meta.toolType) auditEntry.toolType = meta.toolType as AuditEntry["toolType"];
      if (meta.toolSource) auditEntry.toolSource = meta.toolSource as AuditEntry["toolSource"];
      if (meta.toolVersion) auditEntry.toolVersion = meta.toolVersion as string;
      if (meta.toolHash) auditEntry.toolHash = meta.toolHash as string;
    }
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
