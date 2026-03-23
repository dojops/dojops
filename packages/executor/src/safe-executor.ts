import { DevOpsSkill, SkillOutput, VerificationResult } from "@dojops/sdk";
import {
  ExecutionPolicy,
  ExecutionResult,
  ExecutionAuditEntry,
  ApprovalDecision,
  RiskLevel,
  RISK_ORDER,
  isRiskAtOrBelow,
  classifyPathRisk,
} from "./types";
import { ApprovalHandler, AutoApproveHandler, buildPreview } from "./approval";
import { DEFAULT_POLICY, PolicyViolationError, checkWriteAllowed } from "./policy";
import { withTimeout } from "./sandbox";

/** Critique callback for the self-repair loop (injected from @dojops/core). */
export interface CriticCallback {
  critique(
    generatedContent: string,
    verificationResult: VerificationResult,
    skillName: string,
    originalPrompt?: string,
  ): Promise<{ repairInstructions: string }>;
}

/** Progress callback for repair loop UX feedback. */
export interface ExecutorProgressCallback {
  onRepairAttempt?(taskId: string, attempt: number, maxAttempts: number, errors: string[]): void;
  onVerificationFailed?(taskId: string, errors: string[]): void;
  onVerificationPassed?(taskId: string): void;
}

export interface SafeExecutorOptions {
  policy?: Partial<ExecutionPolicy>;
  approvalHandler?: ApprovalHandler;
  /** Optional critic for the self-repair loop. When provided, verification failures trigger
   *  a critique LLM call before re-generation for more targeted repairs. */
  critic?: CriticCallback;
  /** Optional proactive critic that runs after generate but before verify.
   *  Catches semantic issues that linters miss. Separate from the reactive `critic`. */
  proactiveCritic?: CriticCallback;
  /** Optional progress callback for UI feedback during repair loops. */
  progress?: ExecutorProgressCallback;
}

/** Options for the internal runExecution method. */
interface RunExecutionContext {
  taskId: string;
  tool: DevOpsSkill;
  input: unknown;
  generateOutput: SkillOutput;
  approval: ApprovalDecision;
  verification: VerificationResult | undefined;
  startTime: number;
  meta?: Record<string, unknown>;
}

/**
 * Preserve _peerFiles from the initial output so verification can find
 * files written by prior tasks (e.g., role files needed by a playbook task).
 */
function preservePeerFiles(current: SkillOutput, initial: SkillOutput): void {
  if (
    !current.data ||
    typeof current.data !== "object" ||
    !initial.data ||
    typeof initial.data !== "object"
  ) {
    return;
  }
  const initObj = initial.data as Record<string, unknown>;
  if (!("_peerFiles" in initObj)) return;
  const dataObj = current.data as Record<string, unknown>;
  if (!("_peerFiles" in dataObj)) {
    dataObj._peerFiles = initObj._peerFiles;
  }
}

export class SafeExecutor {
  private readonly policy: ExecutionPolicy;
  private readonly approvalHandler: ApprovalHandler;
  private readonly critic: CriticCallback | undefined;
  private readonly proactiveCritic: CriticCallback | undefined;
  private readonly progress: ExecutorProgressCallback | undefined;
  private readonly auditLog: ExecutionAuditEntry[] = [];
  private readonly tokenUsage = { prompt: 0, completion: 0, total: 0 };

  constructor(options: SafeExecutorOptions = {}) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.approvalHandler = options.approvalHandler ?? new AutoApproveHandler();
    this.progress = options.progress;
    this.critic = options.critic;
    this.proactiveCritic = options.proactiveCritic;
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
    tool: DevOpsSkill,
    generateOutput: SkillOutput,
    meta?: Record<string, unknown>,
  ): Promise<
    | { ok: true; verification: VerificationResult | undefined }
    | { ok: false; verification: VerificationResult; error: string }
  > {
    const perTaskSkip = meta?.skipVerification === true;
    if (!tool.verify || this.policy.skipVerification || perTaskSkip) {
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

  /**
   * Advisory check: compare files written against expected files from metadata.
   * Returns a warning string if any expected files are missing, undefined otherwise.
   */
  private checkFileCompleteness(
    filesWritten: string[],
    meta?: Record<string, unknown>,
  ): string | undefined {
    if (!meta?.expectedFiles || !Array.isArray(meta.expectedFiles)) return undefined;
    const expectedFiles = meta.expectedFiles as string[];
    if (expectedFiles.length === 0) return undefined;

    const writtenBasenames = new Set(
      filesWritten.map((f) => {
        const parts = f.split("/");
        return parts[parts.length - 1];
      }),
    );

    const missing = expectedFiles.filter((f) => {
      const parts = f.split("/");
      const basename = parts[parts.length - 1];
      return !writtenBasenames.has(basename);
    });

    if (missing.length === 0) return undefined;
    return `Expected files not written: ${missing.join(", ")}`;
  }

  /**
   * Resolve approval based on policy mode and task risk level.
   *
   * - "never": always auto-approve
   * - "always": always ask the approval handler (legacy behavior)
   * - "risk-based": auto-approve if task risk <= autoApproveRiskLevel, otherwise ask
   *
   * Risk is elevated if generated output declares paths that carry higher risk
   * (e.g., .env files, SSH keys, Terraform state).
   */
  private async resolveApproval(
    taskId: string,
    tool: DevOpsSkill,
    generateOutput: SkillOutput,
    taskRisk?: RiskLevel,
  ): Promise<ApprovalDecision> {
    const mode = this.policy.approvalMode ?? "always";

    if (mode === "never") return "approved";

    // Legacy behavior: requireApproval=false means auto-approve regardless of mode
    if (!this.policy.requireApproval && mode === "always") return "approved";

    if (mode === "risk-based" && taskRisk) {
      // Elevate risk based on output file paths (e.g., .env → HIGH, ~/.ssh → CRITICAL)
      const effectiveRisk = this.elevateRiskByPaths(taskRisk, generateOutput);
      const threshold = this.policy.autoApproveRiskLevel ?? "MEDIUM";
      if (isRiskAtOrBelow(effectiveRisk, threshold)) {
        return "approved";
      }
    }

    // Fall through to interactive approval
    const preview = buildPreview(generateOutput, tool.name);
    return this.approvalHandler.requestApproval({
      taskId,
      skillName: tool.name,
      description: `Write LLM-generated output using ${tool.name}`,
      preview,
    });
  }

  /** Elevate task risk if generated output targets sensitive paths. */
  private elevateRiskByPaths(taskRisk: RiskLevel, generateOutput: SkillOutput): RiskLevel {
    if (!generateOutput.data) return taskRisk;
    const paths = this.extractDeclaredPaths(generateOutput.data);
    if (paths.length === 0) return taskRisk;

    let maxRisk = taskRisk;
    for (const p of paths) {
      const pathRisk = classifyPathRisk(p);
      if (RISK_ORDER[pathRisk] > RISK_ORDER[maxRisk]) {
        maxRisk = pathRisk;
      }
    }
    return maxRisk;
  }

  /** Run tool.execute and check file path policies. */
  private async runExecution(ctx: RunExecutionContext): Promise<ExecutionResult> {
    const { taskId, tool, input, generateOutput, approval, verification, startTime, meta } = ctx;
    const filesWritten: string[] = [];
    const filesModified: string[] = [];
    const filesUnchanged: string[] = [];
    try {
      // Pass pre-generated output to execute so tools can skip redundant LLM calls
      const execInput =
        generateOutput.data !== undefined && typeof input === "object" && input !== null
          ? { ...(input as Record<string, unknown>), _generatedOutput: generateOutput }
          : input;
      const executeOutput = await withTimeout(
        tool.execute!(execInput as never),
        this.policy.executeTimeoutMs ?? this.policy.timeoutMs,
        "Execute phase timed out",
      );

      if (executeOutput.filesWritten) filesWritten.push(...executeOutput.filesWritten);
      if (executeOutput.filesModified) filesModified.push(...executeOutput.filesModified);
      if (executeOutput.filesUnchanged) filesUnchanged.push(...executeOutput.filesUnchanged);

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
          filesUnchanged,
          usage: generateOutput.usage,
          metadata: meta,
        });
      }

      // Advisory file completeness check
      const completenessWarning = this.checkFileCompleteness(filesWritten, meta);

      return this.buildResult(taskId, tool.name, "completed", startTime, {
        output: executeOutput.data,
        approval,
        verification,
        filesWritten,
        filesModified,
        filesUnchanged,
        usage: generateOutput.usage,
        metadata: completenessWarning
          ? { ...meta, _completenessWarning: completenessWarning }
          : meta,
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

  /** Run the generate phase, returning the output or an early ExecutionResult on failure. */
  private async runGeneratePhase(
    taskId: string,
    tool: DevOpsSkill,
    input: unknown,
    startTime: number,
    meta?: Record<string, unknown>,
  ): Promise<{ output: SkillOutput } | { result: ExecutionResult }> {
    try {
      const output = await withTimeout(
        tool.generate(input as never),
        this.policy.generateTimeoutMs ?? this.policy.timeoutMs,
      );
      this.accumulateTokenUsage(output.usage);
      if (!output.success) {
        return {
          result: this.buildResult(taskId, tool.name, "failed", startTime, {
            error: output.error,
            output: output.data,
            filesWritten: [],
            usage: output.usage,
            metadata: meta,
          }),
        };
      }
      return { output };
    } catch (err) {
      const { status, error } = this.handleTimeoutError(err, "Generate");
      return {
        result: this.buildResult(taskId, tool.name, status, startTime, {
          error,
          filesWritten: [],
          metadata: meta,
        }),
      };
    }
  }

  /**
   * Build repair feedback by combining verification errors with critic analysis.
   * If a critic is available, it produces targeted repair instructions.
   * Otherwise, falls back to raw verification error messages.
   */
  private async buildRepairFeedback(
    verifyResult: { verification: VerificationResult; error: string },
    generateOutput: SkillOutput,
    tool: DevOpsSkill,
    input: unknown,
  ): Promise<string> {
    const rawFeedback = verifyResult.verification.issues
      .map((i) => `[${i.severity}] ${i.message}`)
      .join("\n");

    if (!this.critic) return rawFeedback;

    try {
      const dataObj = generateOutput.data as Record<string, unknown> | undefined;
      const nonStringContent =
        typeof dataObj?.generated === "string"
          ? dataObj.generated
          : JSON.stringify(generateOutput.data);
      const generatedContent =
        typeof generateOutput.data === "string" ? generateOutput.data : nonStringContent;

      const originalPrompt =
        typeof input === "object" && input !== null
          ? ((input as Record<string, unknown>).prompt as string | undefined)
          : undefined;

      const critique = await this.critic.critique(
        generatedContent,
        verifyResult.verification,
        tool.name,
        originalPrompt,
      );

      // Combine critic's structured instructions with raw verification errors
      return `## Critic Analysis\n${critique.repairInstructions}\n\n## Verification Errors\n${rawFeedback}`;
    } catch {
      // Critic failed — use raw verification feedback
      return rawFeedback;
    }
  }

  /** Check pre-execution policy on declared output paths. Returns violation message or undefined. */
  private checkDeclaredPathPolicy(generateOutput: SkillOutput): string | undefined {
    if (!this.policy.allowWrite || !generateOutput.data) return undefined;
    const declaredPaths = this.extractDeclaredPaths(generateOutput.data);
    return this.checkFilePaths(declaredPaths);
  }

  /** Extract error messages from a failed verification result. */
  private extractVerificationErrors(verifyResult: { verification: VerificationResult }): string[] {
    return verifyResult.verification.issues
      .filter((i) => i.severity === "error")
      .map((i) => i.message);
  }

  /** Notify progress callbacks about a verification failure. */
  private notifyVerificationFailed(
    taskId: string,
    verifyResult: { verification: VerificationResult },
  ): void {
    if (!this.progress?.onVerificationFailed) return;
    this.progress.onVerificationFailed(taskId, this.extractVerificationErrors(verifyResult));
  }

  /**
   * Self-repair loop: verify → critique → re-generate → verify (up to maxRepairAttempts).
   * Returns the final generateOutput and verifyResult after all repair attempts.
   */
  private async runRepairLoop(
    taskId: string,
    tool: DevOpsSkill,
    input: unknown,
    initialOutput: SkillOutput,
    initialVerify: Awaited<ReturnType<SafeExecutor["runVerification"]>>,
    startTime: number,
    meta?: Record<string, unknown>,
  ): Promise<
    | {
        repaired: true;
        generateOutput: SkillOutput;
        verifyResult: Awaited<ReturnType<SafeExecutor["runVerification"]>>;
      }
    | { repaired: false; earlyResult: ExecutionResult }
  > {
    const maxRetries = this.policy.maxRepairAttempts ?? this.policy.maxVerifyRetries ?? 1;
    let generateOutput = initialOutput;
    let verifyResult = initialVerify;
    let retries = 0;

    while (!verifyResult.ok && retries < maxRetries) {
      if (this.progress?.onRepairAttempt) {
        this.progress.onRepairAttempt(
          taskId,
          retries + 1,
          maxRetries,
          this.extractVerificationErrors(verifyResult),
        );
      }
      const feedback = await this.buildRepairFeedback(verifyResult, generateOutput, tool, input);
      const enrichedInput = {
        ...(typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}),
        _verificationFeedback: feedback,
        _repairAttempt: retries + 1,
        _maxRepairAttempts: maxRetries,
      };
      const regenResult = await this.runGeneratePhase(taskId, tool, enrichedInput, startTime, meta);
      if ("result" in regenResult) {
        return { repaired: false, earlyResult: regenResult.result };
      }
      generateOutput = regenResult.output;
      preservePeerFiles(generateOutput, initialOutput);
      verifyResult = await this.runVerification(tool, generateOutput, meta);
      retries++;
    }

    if (verifyResult.ok && retries > 0 && this.progress?.onVerificationPassed) {
      this.progress.onVerificationPassed(taskId);
    }

    return { repaired: true, generateOutput, verifyResult };
  }

  async executeTask(
    taskId: string,
    tool: DevOpsSkill,
    input: unknown,
    metadata?: Record<string, unknown>,
    preGeneratedOutput?: SkillOutput,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const meta = metadata;
    const taskRisk = meta?.risk as RiskLevel | undefined;

    const validation = tool.validate(input);
    if (!validation.valid) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: `Validation failed: ${validation.error}`,
        filesWritten: [],
        metadata: meta,
      });
    }

    let generateOutput: SkillOutput;
    if (preGeneratedOutput) {
      generateOutput = preGeneratedOutput;
      this.accumulateTokenUsage(generateOutput.usage);
    } else {
      const genResult = await this.runGeneratePhase(taskId, tool, input, startTime, meta);
      if ("result" in genResult) return genResult.result;
      generateOutput = genResult.output;
    }

    // Proactive critique: run a separate critic before verification to catch semantic issues early.
    // If the critic finds errors, attempt one re-generation with repair instructions
    // before entering the formal verify → repair loop.
    if (this.proactiveCritic && !this.policy.skipVerification) {
      try {
        const content =
          typeof generateOutput.data === "string"
            ? generateOutput.data
            : JSON.stringify(generateOutput.data ?? "");
        const preVerify: VerificationResult = {
          passed: true,
          tool: tool.name,
          issues: [],
        };
        const critique = await this.proactiveCritic.critique(content, preVerify, tool.name);
        if (critique.repairInstructions && critique.repairInstructions.length > 20) {
          const regenInput =
            input && typeof input === "object"
              ? {
                  ...(input as Record<string, unknown>),
                  _repairContext: critique.repairInstructions,
                }
              : input;
          const regenResult = await this.runGeneratePhase(
            taskId,
            tool,
            regenInput,
            startTime,
            meta,
          );
          if (!("result" in regenResult)) {
            generateOutput = regenResult.output;
          }
        }
      } catch {
        // Proactive critique is advisory — don't block on failure
      }
    }

    let verifyResult = await this.runVerification(tool, generateOutput, meta);

    if (!verifyResult.ok) {
      this.notifyVerificationFailed(taskId, verifyResult);

      const repairOutcome = await this.runRepairLoop(
        taskId,
        tool,
        input,
        generateOutput,
        verifyResult,
        startTime,
        meta,
      );
      if (!repairOutcome.repaired) return repairOutcome.earlyResult;
      generateOutput = repairOutcome.generateOutput;
      verifyResult = repairOutcome.verifyResult;
    }

    if (!verifyResult.ok) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: verifyResult.error,
        output: generateOutput.data,
        verification: verifyResult.verification,
        filesWritten: [],
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
        filesWritten: [],
        usage: generateOutput.usage,
        metadata: meta,
      });
    }

    const approval = await this.resolveApproval(taskId, tool, generateOutput, taskRisk);
    if (approval === "denied") {
      return this.buildResult(taskId, tool.name, "denied", startTime, {
        output: generateOutput.data,
        approval,
        verification,
        filesWritten: [],
        usage: generateOutput.usage,
        metadata: meta,
      });
    }

    const pathViolation = this.checkDeclaredPathPolicy(generateOutput);
    if (pathViolation) {
      return this.buildResult(taskId, tool.name, "failed", startTime, {
        error: `Pre-execution policy violation on declared output path: ${pathViolation}`,
        output: generateOutput.data,
        approval,
        verification,
        filesWritten: [],
        usage: generateOutput.usage,
        metadata: meta,
      });
    }

    return this.runExecution({
      taskId,
      tool,
      input,
      generateOutput,
      approval,
      verification,
      startTime,
      meta,
    });
  }

  getAuditLog(): ExecutionAuditEntry[] {
    return [...this.auditLog];
  }

  getTokenUsage(): { prompt: number; completion: number; total: number } {
    return { ...this.tokenUsage };
  }

  private buildResult(
    taskId: string,
    skillName: string,
    status: ExecutionResult["status"],
    startTime: number,
    details: {
      output?: unknown;
      error?: string;
      approval?: ApprovalDecision;
      verification?: VerificationResult;
      filesWritten: string[];
      filesModified?: string[];
      filesUnchanged?: string[];
      usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      metadata?: Record<string, unknown>;
    },
  ): ExecutionResult {
    const durationMs = Date.now() - startTime;
    const approval = details.approval ?? "skipped";

    const auditEntry: ExecutionAuditEntry = {
      taskId,
      skillName,
      timestamp: new Date().toISOString(),
      policy: this.policy,
      approval,
      status,
      error: details.error,
      verification: details.verification,
      filesWritten: details.filesWritten,
      filesModified: details.filesModified ?? [],
      filesUnchanged: details.filesUnchanged,
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
      metadata: details.metadata,
    };
  }
}
