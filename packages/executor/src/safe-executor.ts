import { DevOpsTool, ToolOutput, VerificationResult } from "@dojops/sdk";
import { ExecutionPolicy, ExecutionResult, ExecutionAuditEntry, ApprovalDecision } from "./types";
import { ApprovalHandler, AutoApproveHandler, buildPreview } from "./approval";
import { DEFAULT_POLICY, PolicyViolationError, checkWriteAllowed } from "./policy";
import { withTimeout } from "./sandbox";

export interface SafeExecutorOptions {
  policy?: Partial<ExecutionPolicy>;
  approvalHandler?: ApprovalHandler;
}

export class SafeExecutor {
  private readonly policy: ExecutionPolicy;
  private readonly approvalHandler: ApprovalHandler;
  private readonly auditLog: ExecutionAuditEntry[] = [];
  private readonly tokenUsage = { prompt: 0, completion: 0, total: 0 };

  constructor(options: SafeExecutorOptions = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.approvalHandler = options.approvalHandler ?? new AutoApproveHandler();
  }

  private handleTimeoutError(
    err: unknown,
    phase: string,
  ): { status: "timeout" | "failed"; error: string } {
    const isTimeout = err instanceof PolicyViolationError && err.rule === "timeoutMs";
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      status: isTimeout ? "timeout" : "failed",
      error: isTimeout ? `${phase} phase timed out` : errorMessage,
    };
  }

  private accumulateTokenUsage(usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    if (usage) {
      this.tokenUsage.prompt += usage.promptTokens;
      this.tokenUsage.completion += usage.completionTokens;
      this.tokenUsage.total += usage.totalTokens;
    }
  }

  private async runVerification(
    tool: DevOpsTool,
    generateOutput: ToolOutput,
  ): Promise<
    | { ok: true; verification: VerificationResult | undefined }
    | { ok: false; verification: VerificationResult; error: string }
  > {
    if (!tool.verify || this.policy.skipVerification) {
      return { ok: true, verification: undefined };
    }

    try {
      const verification = await withTimeout(
        tool.verify(generateOutput.data),
        this.policy.verifyTimeoutMs ?? this.policy.timeoutMs,
        "Verify phase timed out",
      );

      if (!verification.passed) {
        const errorMessages = verification.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.message)
          .join("; ");
        return { ok: false, verification, error: `Verification failed: ${errorMessages}` };
      }

      return { ok: true, verification };
    } catch (verifyErr) {
      const message = `Verification threw unexpectedly: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`;
      const verification: VerificationResult = {
        passed: false,
        tool: tool.name,
        issues: [{ severity: "error", message }],
      };
      return { ok: false, verification, error: `Verification error: ${message}` };
    }
  }

  private extractDeclaredPaths(data: unknown): string[] {
    const paths: string[] = [];
    const obj = data as Record<string, unknown>;
    if (typeof obj.filePath === "string") paths.push(obj.filePath);
    if (typeof obj.outputPath === "string") paths.push(obj.outputPath);
    if (Array.isArray(obj.files)) {
      for (const f of obj.files) {
        if (typeof f === "string") paths.push(f);
        if (f && typeof f === "object" && typeof (f as Record<string, unknown>).path === "string") {
          paths.push((f as Record<string, unknown>).path as string);
        }
      }
    }
    return paths;
  }

  private checkFilePaths(filePaths: string[]): string | undefined {
    for (const filePath of filePaths) {
      try {
        checkWriteAllowed(filePath, this.policy);
      } catch (policyErr) {
        return policyErr instanceof Error ? policyErr.message : String(policyErr);
      }
    }
    return undefined;
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
      const { status, error } = this.handleTimeoutError(err, "Generate");
      return this.buildResult(taskId, tool.name, status, startTime, {
        error,
        filesWritten,
        metadata: meta,
      });
    }

    this.accumulateTokenUsage(generateOutput.usage);

    if (!generateOutput.success) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: generateOutput.error,
        output: generateOutput.data,
        filesWritten,
        usage: generateOutput.usage,
        metadata: meta,
      });
    }

    const verifyResult = await this.runVerification(tool, generateOutput);
    if (!verifyResult.ok) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: verifyResult.error,
        output: generateOutput.data,
        verification: verifyResult.verification,
        filesWritten,
        usage: generateOutput.usage,
        metadata: meta,
      });
    }
    const { verification } = verifyResult;

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

    if (this.policy.allowWrite && generateOutput.data) {
      const declaredPaths = this.extractDeclaredPaths(generateOutput.data);
      const violation = this.checkFilePaths(declaredPaths);
      if (violation) {
        return this.buildResult(taskId, tool.name, "failed", startTime, {
          error: `Pre-execution policy violation on declared output path: ${violation}`,
          output: generateOutput.data,
          approval,
          verification,
          filesWritten,
          usage: generateOutput.usage,
          metadata: meta,
        });
      }
    }

    try {
      const executeOutput = await withTimeout(
        tool.execute(input as never),
        this.policy.executeTimeoutMs ?? this.policy.timeoutMs,
        "Execute phase timed out",
      );

      if (executeOutput.filesWritten) filesWritten.push(...executeOutput.filesWritten);
      if (executeOutput.filesModified) filesModified.push(...executeOutput.filesModified);

      if (this.policy.allowWrite) {
        const violation = this.checkFilePaths([...filesWritten, ...filesModified]);
        if (violation) {
          return this.buildResult(taskId, tool.name, "failed", startTime, {
            error: `Policy violation on written file: ${violation}`,
            output: executeOutput.data,
            approval,
            verification,
            filesWritten,
            filesModified,
            usage: generateOutput.usage,
            metadata: meta,
          });
        }
      }

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
      const { status, error } = this.handleTimeoutError(err, "Execute");
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

  getAuditLog(): ExecutionAuditEntry[] {
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

    const auditEntry: ExecutionAuditEntry = {
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
      if (meta.toolType) auditEntry.toolType = meta.toolType as ExecutionAuditEntry["toolType"];
      if (meta.toolSource)
        auditEntry.toolSource = meta.toolSource as ExecutionAuditEntry["toolSource"];
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
