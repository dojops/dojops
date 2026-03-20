import * as fs from "node:fs";
import * as path from "node:path";
import { runBin } from "../safe-exec";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { DeterministicProvider } from "@dojops/core";
import { appendActivity } from "../dojops-md";
import { recordTask } from "../memory";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createSkillRegistry } from "@dojops/skill-registry";
import { PlannerExecutor } from "@dojops/planner";
import { CLIContext } from "../types";
import { hasFlag, extractFlagValue } from "../parser";
import {
  statusIcon,
  statusText,
  riskColor,
  wrapForNote,
  truncateNoteTitle,
  formatDuration,
} from "../formatter";
import {
  findProjectRoot,
  loadPlan,
  getLatestPlan,
  savePlan,
  loadSession,
  saveSession,
  saveExecution,
  appendAudit,
  acquireLock,
  releaseLock,
  isLocked,
  loadContext,
  checkGitDirty,
  PlanState,
  getCurrentUser,
  getDojopsVersion,
} from "../state";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { cliApprovalHandler } from "../approval";
import { getDriftWarnings } from "../drift-warning";
import { runHooks } from "../hooks";
import { createProgressReporter } from "../progress";
import { validateReplayIntegrity, checkToolIntegrity } from "./replay-validator";
import { createAutoInstallHandler } from "../toolchain-sandbox";
import { buildFileTree } from "@dojops/session";
// readExistingToolFile is no longer used here — existingContent is detected
// lazily at execution time by each tool's runtime (detectContent in DopsRuntimeV2).

type ToolEntry = ReturnType<ReturnType<typeof createSkillRegistry>["getAll"]>[number];

interface ApplyFlags {
  autoApprove: boolean;
  dryRun: boolean;
  resume: boolean;
  retry: boolean;
  replay: boolean;
  installPackages: boolean;
  skipVerify: boolean;
  force: boolean;
  allowAllPaths: boolean;
  timeoutMs: number;
  jsonOutput: boolean;
  singleTaskId: string | undefined;
  planId: string | undefined;
  maxRepairAttempts: number;
  maxConcurrency: number | undefined;
}

interface TaskResultEntry {
  taskId: string;
  status: string;
  output?: unknown;
  error?: string;
  filesCreated?: string[];
  executionStatus?: string;
  executionApproval?: string;
}

function parseApplyFlags(args: string[], ctx: CLIContext): ApplyFlags {
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const dryRun = hasFlag(args, "--dry-run") || ctx.globalOpts.dryRun;
  const resume = hasFlag(args, "--resume");
  const retry = hasFlag(args, "--retry");
  const replay = hasFlag(args, "--replay");
  const installPackages = hasFlag(args, "--install-packages");
  const skipVerify = hasFlag(args, "--skip-verify");
  const force = hasFlag(args, "--force");
  const allowAllPaths = hasFlag(args, "--allow-all-paths");
  const timeoutArg = extractFlagValue(args, "--timeout");
  const timeoutMs = timeoutArg
    ? Number.parseInt(timeoutArg, 10) * 1000
    : (ctx.globalOpts.timeout ?? 120_000); // --timeout in seconds, or globalOpts.timeout in ms
  if (timeoutArg && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --timeout value: "${timeoutArg}". Must be a positive number (seconds).`,
    );
  }
  const jsonOutput = ctx.globalOpts.output === "json";
  const singleTaskId = extractFlagValue(args, "--task");
  const repairAttemptsArg = extractFlagValue(args, "--repair-attempts");
  const maxRepairAttempts = repairAttemptsArg ? Number.parseInt(repairAttemptsArg, 10) : 3;
  if (repairAttemptsArg && (!Number.isFinite(maxRepairAttempts) || maxRepairAttempts < 0)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --repair-attempts value: "${repairAttemptsArg}". Must be a non-negative integer.`,
    );
  }
  const parallelArg = extractFlagValue(args, "--parallel");
  const maxConcurrency = parallelArg ? Number.parseInt(parallelArg, 10) : undefined;
  if (parallelArg && (!Number.isFinite(maxConcurrency!) || maxConcurrency! < 1)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --parallel value: "${parallelArg}". Must be a positive integer.`,
    );
  }
  const planId = args.find(
    (a) => !a.startsWith("-") && a !== singleTaskId && a !== repairAttemptsArg && a !== parallelArg,
  );

  return {
    autoApprove,
    dryRun,
    resume,
    retry,
    replay,
    installPackages,
    skipVerify,
    force,
    allowAllPaths,
    timeoutMs,
    jsonOutput,
    singleTaskId,
    planId,
    maxRepairAttempts,
    maxConcurrency,
  };
}

function resolvePlan(root: string, planId: string | undefined, jsonOutput: boolean): PlanState {
  if (planId) {
    const plan = loadPlan(root, planId);
    if (!plan) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Plan "${planId}" not found.`);
    }
    return plan;
  }

  const session = loadSession(root);
  if (session.currentPlan) {
    const plan = loadPlan(root, session.currentPlan);
    if (plan && !jsonOutput) {
      p.log.info(`Using session plan: ${pc.cyan(plan.id)}`);
    }
    if (plan) return plan;
  }

  const plan = getLatestPlan(root);
  if (plan && !jsonOutput) {
    p.log.info(`Using latest plan: ${pc.cyan(plan.id)}`);
  }
  if (plan) return plan;

  throw new CLIError(ExitCode.VALIDATION_ERROR, "No plan found. Run `dojops plan <prompt>` first.");
}

function validateSingleTask(plan: PlanState, singleTaskId: string): void {
  const taskExists = plan.tasks.some((t) => t.id === singleTaskId);
  if (!taskExists) {
    const available = plan.tasks.map((t) => t.id).join(", ");
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Task "${singleTaskId}" not found in plan. Available: ${available}`,
    );
  }
  p.log.info(`Single task mode: running only ${pc.bold(singleTaskId)}`);
}

function buildCompletedIdsForSingleTask(plan: PlanState, singleTaskId: string): Set<string> {
  return new Set(plan.tasks.filter((t) => t.id !== singleTaskId).map((t) => t.id));
}

function buildCompletedIdsForResume(plan: PlanState, retry: boolean): Set<string> {
  if (!plan.results?.length) {
    p.log.warn("No previous results found. Running full execution.");
    return new Set<string>();
  }

  const completedTaskIds = new Set(
    plan.results
      .filter((r) => {
        if (r.status === "completed" && r.executionStatus === "completed") return true;
        if (retry && (r.status === "failed" || r.executionStatus === "failed")) return false;
        return false;
      })
      .map((r) => r.taskId),
  );

  if (completedTaskIds.size > 0) {
    p.log.info(`Resuming: skipping ${completedTaskIds.size} completed task(s)`);
  }
  if (retry) {
    const failedCount = plan.results.filter(
      (r) => r.status === "failed" || r.executionStatus === "failed",
    ).length;
    if (failedCount > 0) {
      p.log.info(`Retrying ${failedCount} previously failed task(s)`);
    }
  }
  return completedTaskIds;
}

function buildCompletedTaskIds(plan: PlanState, flags: ApplyFlags): Set<string> {
  if (flags.singleTaskId) {
    return buildCompletedIdsForSingleTask(plan, flags.singleTaskId);
  }
  if (flags.resume) {
    return buildCompletedIdsForResume(plan, flags.retry);
  }
  return new Set<string>();
}

function applyToolFilter(
  plan: PlanState,
  completedTaskIds: Set<string>,
  toolFilter: string,
  jsonOutput: boolean,
): void {
  const matchingTools = plan.tasks.filter((t) => t.tool === toolFilter);
  if (matchingTools.length === 0) {
    const usedTools = [...new Set(plan.tasks.map((t) => t.tool))].join(", ");
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `No tasks use module "${toolFilter}". Modules in this plan: ${usedTools}`,
    );
  }
  const skippedIds = plan.tasks.filter((t) => t.tool !== toolFilter).map((t) => t.id);
  for (const id of skippedIds) {
    completedTaskIds.add(id);
  }
  if (!jsonOutput && skippedIds.length > 0) {
    p.log.info(
      `Filtering by module: ${pc.bold(toolFilter)} — skipping ${skippedIds.length} task(s)`,
    );
  }
}

function displayPreFlightSummary(
  plan: PlanState,
  completedTaskIds: Set<string>,
  resume: boolean,
): void {
  const totalCount = plan.tasks.length;
  const remainingCount = totalCount - completedTaskIds.size;

  const summaryLines = [
    `${pc.bold("Plan:")}   ${plan.id}`,
    `${pc.bold("Goal:")}   ${plan.goal}`,
    `${pc.bold("Tasks:")}  ${resume && completedTaskIds.size > 0 ? remainingCount + " remaining / " + totalCount + " total" : totalCount + " tasks"}`,
    `${pc.bold("Risk:")}   ${plan.risk || "unknown"}`,
  ];

  const toolsUsed = [...new Set(plan.tasks.map((t) => t.tool))];
  summaryLines.push(
    `${pc.bold("Skills:")}  ${toolsUsed.join(", ")}`,
    "",
    pc.bold("Task breakdown:"),
  );

  for (const task of plan.tasks) {
    const isCompleted = completedTaskIds.has(task.id);
    const icon = isCompleted ? pc.green("\u2713") : pc.cyan("\u25CB");
    const deps = task.dependsOn.length > 0 ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    summaryLines.push(
      `  ${icon} ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`,
    );
  }

  p.note(
    wrapForNote(summaryLines.join("\n")),
    resume && completedTaskIds.size > 0 ? "Pre-flight: Resume" : "Pre-flight Summary",
  );
}

function displayVersionDriftWarning(plan: PlanState): void {
  if (!plan.executionContext?.dojopsVersion) return;
  const currentVersion = getDojopsVersion();
  if (plan.executionContext.dojopsVersion !== currentVersion) {
    p.log.warn(
      `Plan was created with DojOps v${plan.executionContext.dojopsVersion}, ` +
        `current is v${currentVersion}.`,
    );
  }
}

function displayToolDriftWarnings(plan: PlanState): void {
  const toolsUsed = [...new Set(plan.tasks.map((t) => t.tool))];
  const driftWarnings = getDriftWarnings(toolsUsed);
  for (const dw of driftWarnings) {
    p.log.warn(`${pc.yellow(dw.tool)}: ${dw.message}`);
  }
}

function displayImpactSummary(plan: PlanState, completedTaskIds: Set<string>): void {
  const remainingTasks = plan.tasks.filter((t) => !completedTaskIds.has(t.id));
  const MULTI_FILE_TOOLS = new Set(["helm", "docker-compose"]);
  const estimatedFiles = remainingTasks.reduce(
    (sum, t) => sum + (MULTI_FILE_TOOLS.has(t.tool) ? 2 : 1),
    0,
  );
  const verificationTools = [
    ...new Set(
      remainingTasks
        .map((t) => t.tool)
        .filter((tool) =>
          ["terraform", "dockerfile", "kubernetes", "github-actions", "gitlab-ci"].includes(tool),
        ),
    ),
  ];

  const impactLines = [
    `${pc.bold("Files to write:")}    ~${estimatedFiles}`,
    `${pc.bold("Verification:")}     ${verificationTools.length > 0 ? verificationTools.join(", ") : pc.dim("none")}`,
    `${pc.bold("Risk level:")}       ${riskColor(plan.risk || "unknown")}`,
  ];
  p.note(impactLines.join("\n"), "Impact Summary");
}

async function executeDryRun(
  ctx: CLIContext,
  root: string,
  remainingTasks: PlanState["tasks"],
): Promise<void> {
  p.log.info(pc.dim("Dry run — previewing what would be generated (no files written)."));

  try {
    const provider = ctx.getProvider();
    const projectContext = buildFileTree(root);
    const registry = createSkillRegistry(provider, root, {
      onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
      projectContext: projectContext || undefined,
    });
    const tools = registry.getAll();

    for (const task of remainingTasks) {
      const tool = tools.find((t) => t.name === task.tool);
      if (!tool) {
        p.log.warn(`Skipping ${pc.bold(task.id)}: module "${task.tool}" not found.`);
        continue;
      }
      await generateDryRunPreview(task, tool);
    }
  } catch (err) {
    p.log.warn(`Could not preview tasks: ${toErrorMessage(err)}`);
  }
}

async function generateDryRunPreview(
  task: PlanState["tasks"][number],
  tool: { generate(input: Record<string, unknown>): Promise<unknown> },
): Promise<void> {
  try {
    const input =
      task.input && Object.keys(task.input).length > 0 ? task.input : { prompt: task.description };
    const result = await tool.generate(input);
    const preview = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    const truncated =
      preview.length > 5000
        ? preview.slice(0, 5000) + "\n... (truncated — use --output json for full content)"
        : preview;
    p.note(
      wrapForNote(truncated),
      truncateNoteTitle(`${task.id} — ${task.tool}: ${task.description}`),
    );
  } catch (err) {
    p.log.warn(`${pc.bold(task.id)} generation failed: ${toErrorMessage(err)}`);
  }
}

async function confirmHighRiskPlan(
  plan: PlanState,
  flags: ApplyFlags,
  ctx: CLIContext,
): Promise<void> {
  if (plan.risk !== "HIGH" || flags.force) return;

  p.log.warn(pc.bold(pc.red("This plan is classified as HIGH risk.")));
  if (ctx.globalOpts.nonInteractive) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "HIGH risk plans require --force in non-interactive mode.",
    );
  }
  if (flags.autoApprove) {
    p.log.warn("HIGH risk plans require explicit confirmation. Use --force to bypass.");
    const highRiskConfirm = await p.confirm({
      message: "This is a HIGH risk plan. Are you sure you want to proceed?",
    });
    if (p.isCancel(highRiskConfirm) || !highRiskConfirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }
}

async function confirmApply(autoApprove: boolean): Promise<void> {
  if (autoApprove) return;
  const confirm = await p.confirm({ message: "Apply this plan?" });
  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}

function acquireApplyLock(root: string): void {
  if (!acquireLock(root, "apply")) {
    const { info } = isLocked(root);
    throw new CLIError(
      ExitCode.LOCK_CONFLICT,
      `Operation locked by PID ${info?.pid} (${info?.operation})`,
    );
  }
}

function setupSignalHandlers(root: string): {
  interrupted: { value: boolean };
  sigintHandler: () => void;
  sigtermHandler: () => void;
} {
  const interrupted = { value: false };
  const onSignal = (signal: string) => {
    if (interrupted.value) {
      releaseLock(root);
      process.exit(ExitCode.GENERAL_ERROR);
    }
    interrupted.value = true;
    p.log.warn(`\nReceived ${signal}. Finishing current task before stopping...`);
    p.log.info("Press Ctrl+C again to force exit.");
  };
  const sigintHandler = () => onSignal("SIGINT");
  const sigtermHandler = () => onSignal("SIGTERM");
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  return { interrupted, sigintHandler, sigtermHandler };
}

async function handleGitDirtyCheck(root: string, flags: ApplyFlags): Promise<void> {
  if (flags.force) return;
  const gitStatus = checkGitDirty(root);
  if (!gitStatus.dirty) return;

  p.log.warn(pc.bold("Working tree has uncommitted changes:"));
  for (const f of gitStatus.files.slice(0, 10)) {
    p.log.warn(`  ${pc.yellow(f)}`);
  }
  if (gitStatus.files.length > 10) {
    p.log.warn(pc.dim(`  ...and ${gitStatus.files.length - 10} more`));
  }

  if (flags.autoApprove) {
    p.log.warn("Proceeding despite dirty tree (--yes).");
    return;
  }

  const proceed = await p.confirm({
    message: "Continue with uncommitted changes?",
  });
  if (p.isCancel(proceed) || !proceed) {
    p.cancel("Commit or stash changes first, or use --force to skip this check.");
    releaseLock(root);
    process.exit(0);
  }
}

function handleReplayValidation(
  plan: PlanState,
  provider: { name: string },
  model: string | undefined,
  registry: ReturnType<typeof createSkillRegistry>,
  force: boolean,
  root: string,
): void {
  const result = validateReplayIntegrity(plan, provider.name, model, registry);
  if (result.valid) {
    p.log.success("Replay validation passed.");
    return;
  }

  p.log.warn(pc.bold("Replay integrity check failed:"));
  for (const m of result.mismatches) {
    const taskLabel = m.taskId ? ` [task ${m.taskId}]` : "";
    p.log.warn(
      `  ${pc.yellow("!")} ${m.field}${taskLabel}: expected "${m.expected}", got "${m.actual}"`,
    );
  }
  if (!force) {
    releaseLock(root);
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Replay aborted due to environment mismatch. Use --force to override.",
    );
  }
  p.log.warn("Continuing despite replay mismatches (--force).");
}

async function handleToolIntegrityCheck(
  plan: PlanState,
  tools: ReturnType<ReturnType<typeof createSkillRegistry>["getAll"]>,
  autoApprove: boolean,
  root: string,
): Promise<void> {
  const { mismatches: toolMismatches, hasMismatches } = checkToolIntegrity(plan.tasks, tools);
  if (!hasMismatches) return;

  p.log.warn(pc.bold("Skill integrity warnings:"));
  for (const msg of toolMismatches) {
    p.log.warn(`  ${pc.yellow("!")} ${msg}`);
  }

  if (autoApprove) return;

  const proceed = await p.confirm({
    message: "Skills have changed since this plan was created. Continue anyway?",
  });
  if (p.isCancel(proceed) || !proceed) {
    p.cancel("Aborted due to module integrity mismatch.");
    releaseLock(root);
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }
}

function buildTaskGraph(plan: PlanState) {
  // NOTE: existingContent is NOT pre-read here. Each tool's runtime detects
  // existing files from disk at execution time via detectContent(). This is
  // critical for multi-task plans where earlier tasks create files that later
  // tasks need to see (e.g. "create composite action" → "update workflow to use it").
  return {
    goal: plan.goal,
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      tool: t.tool,
      description: t.description,
      dependsOn: t.dependsOn,
      input: { ...t.input },
    })),
  };
}

function createExecutorWithCallbacks(
  tools: ReturnType<ReturnType<typeof createSkillRegistry>["getAll"]>,
  graph: ReturnType<typeof buildTaskGraph>,
  ctx: CLIContext,
  jsonOutput: boolean,
  generateTimeoutMs?: number,
) {
  const taskTimers = new Map<string, number>();
  const progress = jsonOutput ? null : createProgressReporter(graph.tasks.length);
  const executor = new PlannerExecutor(
    tools,
    {
      taskStart(id, desc) {
        if (progress) {
          progress.start(id, desc);
        } else {
          p.log.step(`Running ${pc.blue(id)}: ${desc}`);
        }
        taskTimers.set(id, Date.now());
        if (ctx.globalOpts.verbose) {
          const task = graph.tasks.find((t) => t.id === id);
          p.log.info(
            `  Skill: ${pc.bold(task?.tool ?? "unknown")}, deps: [${task?.dependsOn.join(", ") ?? ""}]`,
          );
        }
      },
      taskEnd(id, status, error) {
        const elapsed = taskTimers.has(id) ? Date.now() - taskTimers.get(id)! : 0;
        if (progress && error) {
          progress.fail(id, error);
        } else if (progress) {
          progress.complete(id);
        } else if (error) {
          p.log.error(`${pc.blue(id)}: ${statusText(status)} - ${pc.red(error)}`);
        } else {
          const label = status === "completed" ? "generated" : statusText(status);
          p.log.info(`${pc.blue(id)}: ${label}`);
        }
        if (ctx.globalOpts.verbose) {
          p.log.info(`  Generated in ${elapsed}ms`);
        }
      },
    },
    generateTimeoutMs ? { generateTimeoutMs } : undefined,
  );
  return { executor, progress };
}

/** Documentation files that no DevOps tool can generate — they always fail verification. */
const DOC_FILE_PATTERNS = [
  /\breadme\b/i,
  /\bchangelog\b/i,
  /\bcontributing\b/i,
  /\blicense\b/i,
  /\.md\b/i,
  /\bdocumentation\b/i,
];

function isAnalysisTask(description: string, prompt?: string): boolean {
  const text = `${description} ${prompt ?? ""}`;
  // Match decomposer convention: "Do NOT generate any files" (exact phrase)
  if (/do\s+not\s+generate\s+any\s+files/i.test(text)) return true;
  if (/\banalyze\s+only\b/i.test(text)) return true;
  return false;
}

function isDocumentationTask(description: string, prompt?: string): boolean {
  const text = `${description} ${prompt ?? ""}`;
  return DOC_FILE_PATTERNS.some((p) => p.test(text));
}

async function buildToolMetadata(
  taskDef: PlanState["tasks"][number] | undefined,
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {};
  if (taskDef?.toolType) metadata.toolType = taskDef.toolType;
  if (taskDef?.toolVersion) metadata.toolVersion = taskDef.toolVersion;
  if (taskDef?.toolHash) metadata.toolHash = taskDef.toolHash;
  if (taskDef?.toolSource) metadata.toolSource = taskDef.toolSource;
  // Per-task risk classification for risk-based approval
  if (taskDef) {
    const { classifyTaskRisk } = await import("../risk-classifier");
    metadata.risk = classifyTaskRisk({ tool: taskDef.tool, description: taskDef.description });
    // Skip verification for analysis-only or documentation tasks
    // (analysis produces text, docs produce markdown — neither can pass tool-specific validators)
    const prompt = taskDef.input?.prompt as string | undefined;
    // Analysis tasks skip verification even for known tools — they produce prose, not config files
    if (isAnalysisTask(taskDef.description, prompt)) {
      metadata.skipVerification = true;
    }
    // Documentation tasks skip verification only for non-tool tasks
    // (a Helm chart mentioning README.md is not a "documentation task")
    if (!KNOWN_MODULE_TOOLS.has(taskDef.tool) && isDocumentationTask(taskDef.description, prompt)) {
      metadata.skipVerification = true;
    }
  }
  return metadata;
}

function renderVerificationIssues(
  execResult: {
    verification?: {
      passed: boolean;
      issues: Array<{ severity: string; message: string; line?: number; rule?: string }>;
    };
  },
  verbose: boolean,
): void {
  if (verbose && execResult.verification) {
    p.log.info(
      `  Verification: ${execResult.verification.passed ? pc.green("passed") : pc.red("failed")} (${execResult.verification.issues.length} issue(s))`,
    );
  }
  if (!execResult.verification?.issues.length) return;

  for (const issue of execResult.verification.issues) {
    const line = issue.line ? `:${issue.line}` : "";
    const rule = issue.rule ? ` [${issue.rule}]` : "";
    if (issue.severity === "error") {
      p.log.error(`  ${pc.red("\u2717")} ${issue.message}${line}${rule}`);
    } else if (issue.severity === "warning") {
      p.log.warn(`  ${pc.yellow("!")} ${issue.message}${line}${rule}`);
    } else {
      p.log.info(pc.dim(`    ${issue.message}${line}${rule}`));
    }
  }
}

function renderExecutionResult(
  execResult: {
    taskId: string;
    status: string;
    approval?: string;
    error?: string;
    auditLog?: {
      filesWritten: string[];
      filesModified: string[];
    };
    filesUnchanged?: string[];
    verification?: {
      passed: boolean;
      issues: Array<{ severity: string; message: string; line?: number; rule?: string }>;
    };
  },
  verbose: boolean,
): void {
  const approval =
    execResult.approval === "approved"
      ? pc.green(execResult.approval)
      : pc.yellow(execResult.approval);
  const icon = statusIcon(execResult.status);
  p.log.message(
    `${icon} ${pc.blue(execResult.taskId)} ${statusText(execResult.status)} (approval: ${approval})`,
  );
  if (execResult.error) {
    p.log.error(`  ${pc.red("Error:")} ${execResult.error}`);
  }
  // Show file actions per task
  const audit = execResult.auditLog;
  if (audit) {
    for (const f of audit.filesWritten) {
      p.log.message(`  ${pc.green("+")} ${f}`);
    }
    for (const f of audit.filesModified) {
      p.log.message(`  ${pc.yellow("~")} ${f}`);
    }
    if (verbose && execResult.filesUnchanged) {
      for (const f of execResult.filesUnchanged) {
        p.log.message(`  ${pc.dim("○")} ${pc.dim(f)} ${pc.dim("(unchanged)")}`);
      }
    }
  }
  renderVerificationIssues(execResult, verbose);
}

function processCompletedTask(
  taskResult: { taskId: string; status: string; output?: unknown; error?: string },
  plan: PlanState,
): TaskResultEntry | null {
  const prev = plan.results?.find((r) => r.taskId === taskResult.taskId);
  return prev ?? null;
}

function processFailedOrMissingTask(taskResult: {
  taskId: string;
  status: string;
  output?: unknown;
  error?: string;
}): TaskResultEntry {
  return {
    taskId: taskResult.taskId,
    status: taskResult.status,
    error: taskResult.error,
  };
}

function processNonExecutableTask(taskResult: {
  taskId: string;
  status: string;
  output?: unknown;
  error?: string;
}): TaskResultEntry {
  return {
    taskId: taskResult.taskId,
    status: taskResult.status,
    output: taskResult.output,
  };
}

interface ApplyContext {
  root: string;
  plan: PlanState;
  safeExecutor: SafeExecutor;
  allFilesCreated: string[];
  allFilesModified: string[];
  jsonOutput: boolean;
  verbose: boolean;
}

/** Collect files written by completed same-tool tasks for cross-task verification context. */
function collectPeerFiles(taskId: string, ctx: ApplyContext): Record<string, string> {
  const peers: Record<string, string> = {};
  const root = ctx.root;
  // Read files already written to disk by prior tasks (e.g., other .tf files, role directories)
  // Preserve relative paths so the verification temp dir mirrors the project structure
  // (e.g., ansible roles at roles/common/tasks/main.yml, not flattened to main.yml)
  for (const filePath of ctx.allFilesCreated) {
    try {
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
      peers[filePath] = fs.readFileSync(absPath, "utf-8");
    } catch {
      // File may have been cleaned up or moved — skip
    }
  }
  return peers;
}

async function processExecutableTask(
  taskResult: { taskId: string; status: string; output?: unknown; error?: string },
  taskNode: { input: Record<string, unknown> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any,
  ctx: ApplyContext,
): Promise<TaskResultEntry> {
  const taskDef = ctx.plan.tasks.find((t) => t.id === taskResult.taskId);
  const metadata = await buildToolMetadata(taskDef);

  // Collect files from completed prior tasks for cross-task verification context
  // (e.g., terraform validate needs all .tf files, not just the current task's output)
  const peerFiles = collectPeerFiles(taskResult.taskId, ctx);

  // Pass pre-generated output from planner to avoid re-running the LLM generate phase.
  // Extract _usage embedded by PlannerExecutor so SafeExecutor can track token counts.
  let preGenerated:
    | {
        success: true;
        data: unknown;
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      }
    | undefined;
  if (taskResult.output) {
    const outputObj =
      taskResult.output && typeof taskResult.output === "object"
        ? (taskResult.output as Record<string, unknown>)
        : undefined;
    const usage = outputObj?._usage as
      | { promptTokens: number; completionTokens: number; totalTokens: number }
      | undefined;
    preGenerated = { success: true as const, data: taskResult.output, usage };
  }

  // Inject peer files into the pre-generated data so verify() can include them
  if (preGenerated && Object.keys(peerFiles).length > 0) {
    const data =
      preGenerated.data && typeof preGenerated.data === "object"
        ? { ...(preGenerated.data as Record<string, unknown>), _peerFiles: peerFiles }
        : { generated: preGenerated.data, _peerFiles: peerFiles };
    preGenerated = { ...preGenerated, data };
  }

  const execResult = await ctx.safeExecutor.executeTask(
    taskResult.taskId,
    tool,
    taskNode.input,
    Object.keys(metadata).length > 0 ? metadata : undefined,
    preGenerated,
  );
  const taskFiles = execResult.auditLog?.filesWritten ?? [];
  const taskModified = execResult.auditLog?.filesModified ?? [];
  ctx.allFilesCreated.push(...taskFiles);
  ctx.allFilesModified.push(...taskModified);

  if (!ctx.jsonOutput) {
    renderExecutionResult(execResult, ctx.verbose);
  }

  return {
    taskId: taskResult.taskId,
    status: taskResult.status,
    output: taskResult.output,
    filesCreated: taskFiles,
    executionStatus: execResult.status,
    executionApproval: execResult.approval,
    error: execResult.error,
  };
}

/** Built-in module tools that always produce valid tool-generated output. */
const KNOWN_MODULE_TOOLS = new Set([
  "terraform",
  "kubernetes",
  "helm",
  "ansible",
  "docker-compose",
  "dockerfile",
  "nginx",
  "makefile",
  "gitlab-ci",
  "github-actions",
  "prometheus",
  "systemd",
  "jenkinsfile",
]);

function shouldSkipDocTask(
  taskResult: { taskId: string },
  plan: PlanState,
  jsonOutput: boolean,
): boolean {
  const taskDef = plan.tasks.find((t) => t.id === taskResult.taskId);
  if (!taskDef) return false;

  // Known module tools always produce file output — never skip them
  // (a Helm chart mentioning README.md is not a "documentation task")
  if (KNOWN_MODULE_TOOLS.has(taskDef.tool)) return false;

  const taskPrompt = taskDef.input?.prompt as string | undefined;
  if (!isDocumentationTask(taskDef.description, taskPrompt)) return false;

  if (!jsonOutput) {
    p.log.info(
      `${pc.dim("○")} ${pc.bold(taskResult.taskId)} ${pc.dim("skipped (documentation task — not a tool-generated file)")}`,
    );
  }
  return true;
}

async function classifyAndProcessTask(
  taskResult: { taskId: string; status: string; output?: unknown; error?: string },
  graph: ReturnType<typeof buildTaskGraph>,
  toolMap: Map<string, ToolEntry>,
  ctx: ApplyContext,
): Promise<TaskResultEntry> {
  const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);

  if (taskResult.status !== "completed" || !taskNode) {
    return processFailedOrMissingTask(taskResult);
  }

  const tool = toolMap.get(taskNode.tool);
  if (!tool?.execute) {
    return processNonExecutableTask(taskResult);
  }

  if (shouldSkipDocTask(taskResult, ctx.plan, ctx.jsonOutput)) {
    return { taskId: taskResult.taskId, status: "completed", output: taskResult.output };
  }

  // Analysis tasks produce prose, not config files — skip execution (file writing)
  const taskDef = ctx.plan.tasks.find((t) => t.id === taskResult.taskId);
  if (taskDef) {
    const taskPrompt = taskDef.input?.prompt as string | undefined;
    if (isAnalysisTask(taskDef.description, taskPrompt)) {
      if (!ctx.jsonOutput) {
        p.log.info(
          `${pc.dim("○")} ${pc.bold(taskResult.taskId)} ${pc.dim("skipped (analysis-only task)")}`,
        );
      }
      return { taskId: taskResult.taskId, status: "completed", output: taskResult.output };
    }
  }

  return processExecutableTask(taskResult, taskNode, tool, ctx);
}

async function processTaskResults(
  planResult: {
    results: Array<{ taskId: string; status: string; output?: unknown; error?: string }>;
  },
  graph: ReturnType<typeof buildTaskGraph>,
  toolMap: Map<string, ToolEntry>,
  completedTaskIds: Set<string>,
  interrupted: { value: boolean },
  ctx: ApplyContext,
): Promise<{
  newResults: TaskResultEntry[];
  allFilesCreated: string[];
  allFilesModified: string[];
}> {
  const allFilesCreated: string[] = [];
  const allFilesModified: string[] = [];
  const newResults: TaskResultEntry[] = [];

  for (const taskResult of planResult.results) {
    if (interrupted.value) {
      p.log.warn("Apply interrupted by user. Partial results saved.");
      break;
    }

    if (completedTaskIds.has(taskResult.taskId)) {
      const prev = processCompletedTask(taskResult, ctx.plan);
      if (prev) newResults.push(prev);
      continue;
    }

    const result = await classifyAndProcessTask(taskResult, graph, toolMap, {
      ...ctx,
      allFilesCreated,
      allFilesModified,
    });
    newResults.push(result);
  }

  return { newResults, allFilesCreated, allFilesModified };
}

function computeExecutionStatus(newResults: TaskResultEntry[]): string {
  const allCompleted = newResults.every(
    (r) => r.status === "completed" && (!r.executionStatus || r.executionStatus === "completed"),
  );
  const someCompleted = newResults.some(
    (r) => r.status === "completed" && (!r.executionStatus || r.executionStatus === "completed"),
  );
  if (allCompleted) return "SUCCESS";
  if (someCompleted) return "PARTIAL";
  return "FAILURE";
}

interface SaveApplyContext {
  root: string;
  plan: PlanState;
  durationMs: number;
  replay: boolean;
  planSuccess: boolean;
}

async function saveApplyResults(
  results: {
    newResults: TaskResultEntry[];
    allFilesCreated: string[];
    allFilesModified: string[];
    status: string;
  },
  ctx: SaveApplyContext,
): Promise<void> {
  saveExecution(ctx.root, {
    planId: ctx.plan.id,
    executedAt: new Date().toISOString(),
    status: results.status as "SUCCESS" | "FAILURE" | "PARTIAL",
    filesCreated: results.allFilesCreated,
    filesModified: results.allFilesModified,
    durationMs: ctx.durationMs,
  });

  ctx.plan.results = results.newResults;
  ctx.plan.approvalStatus = results.status === "SUCCESS" ? "APPLIED" : "PARTIAL";
  savePlan(ctx.root, ctx.plan);

  // Track activity in DOJOPS.md
  const allFiles = [...results.allFilesCreated, ...results.allFilesModified];
  const fileNames = allFiles.map((f) => `\`${f}\``).join(", ");
  const fileList = allFiles.length > 0 ? ` (${fileNames})` : "";
  appendActivity(ctx.root, `Plan applied: ${results.status}${fileList}`);
  recordTask(ctx.root, {
    timestamp: new Date().toISOString(),
    task_type: "apply",
    prompt: ctx.plan.goal ?? "",
    result_summary: `Plan applied: ${results.status}${fileList}`,
    status: results.status === "SUCCESS" ? "success" : "failure",
    duration_ms: 0,
    related_files: JSON.stringify(allFiles),
    agent_or_skill: "",
    metadata: JSON.stringify({ planId: ctx.plan.id }),
  });

  const session = loadSession(ctx.root);
  session.mode = "IDLE";
  saveSession(ctx.root, session);

  await appendAudit(ctx.root, {
    timestamp: new Date().toISOString(),
    user: getCurrentUser(),
    command: `apply${ctx.replay ? " --replay" : ""} ${ctx.plan.id}`,
    action: "apply",
    planId: ctx.plan.id,
    status: ctx.planSuccess ? "success" : "failure",
    durationMs: ctx.durationMs,
  });
}

function outputJsonResult(
  plan: PlanState,
  status: string,
  newResults: TaskResultEntry[],
  allFilesCreated: string[],
  allFilesModified: string[],
  durationMs: number,
): void {
  console.log(
    JSON.stringify(
      {
        planId: plan.id,
        status,
        tasks: newResults.map((r) => ({
          taskId: r.taskId,
          status: r.status,
          executionStatus: r.executionStatus,
          error: r.error,
        })),
        filesCreated: allFilesCreated,
        filesModified: allFilesModified,
        durationMs,
      },
      null,
      2,
    ),
  );
}

function outputHumanResult(
  status: string,
  filesCreated: string[],
  filesModified: string[],
  durationMs: number,
): void {
  if (status === "SUCCESS") {
    const total = filesCreated.length + filesModified.length;
    const parts: string[] = [];
    if (filesCreated.length > 0) parts.push(pc.green(`${filesCreated.length} created`));
    if (filesModified.length > 0) parts.push(pc.yellow(`${filesModified.length} modified`));
    const fileSummary = total > 0 ? ` (${parts.join(", ")})` : "";
    const durationLabel = pc.dim(`in ${formatDuration(durationMs)}`);
    p.log.success(`${pc.bold("Plan applied successfully.")}${fileSummary} ${durationLabel}`);
  } else if (status === "PARTIAL") {
    p.log.warn(pc.bold("Plan partially applied. Use `dojops apply --resume` to continue."));
  } else {
    p.log.error(pc.bold("Plan application failed."));
  }
}

function displayTokenUsage(safeExecutor: SafeExecutor): void {
  const tokenUsage = safeExecutor.getTokenUsage();
  if (tokenUsage.total > 0) {
    p.log.info(
      `Token usage: ${tokenUsage.prompt.toLocaleString()} prompt + ` +
        `${tokenUsage.completion.toLocaleString()} completion = ` +
        `${tokenUsage.total.toLocaleString()} total`,
    );
  }
}

function runPostApplyInstall(root: string): void {
  const repoCtx = loadContext(root);
  const pm = repoCtx?.packageManager?.name;
  const installCmd = resolveInstallCommand(pm);

  if (!installCmd) {
    p.log.info(pc.dim("No package manager detected — skipping install."));
    return;
  }

  const installSpinner = p.spinner();
  installSpinner.start(`Running ${installCmd.join(" ")}...`);
  try {
    runBin(installCmd[0], installCmd.slice(1), {
      cwd: root,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: "pipe",
    });
    installSpinner.stop(`${installCmd.join(" ")} completed.`);
  } catch (err) {
    installSpinner.stop(`${installCmd.join(" ")} failed.`);
    const msg = toErrorMessage(err);
    p.log.warn(`Package install failed: ${msg}`);
  }
}

async function executeApplyPlan(
  ctx: CLIContext,
  root: string,
  plan: PlanState,
  flags: ApplyFlags,
  completedTaskIds: Set<string>,
  interrupted: { value: boolean },
  startTime: number,
): Promise<void> {
  let provider = ctx.getProvider();
  if (flags.replay) {
    provider = new DeterministicProvider(provider);
  }
  const projectContext = buildFileTree(root);
  const registry = createSkillRegistry(provider, root, {
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
    projectContext: projectContext || undefined,
  });
  const tools = registry.getAll();

  if (flags.replay) {
    handleReplayValidation(plan, provider, ctx.globalOpts.model, registry, flags.force, root);
  }

  if (flags.resume) {
    await handleToolIntegrityCheck(plan, tools, flags.autoApprove, root);
  }

  // Build critic for self-repair loop (uses same LLM provider)
  let critic: import("@dojops/executor").CriticCallback | undefined;
  try {
    const { CriticAgent } = await import("@dojops/core");
    critic = new CriticAgent(provider);
  } catch {
    // CriticAgent not available — self-repair will use raw verification feedback
  }

  const safeExecutor = new SafeExecutor({
    policy: {
      allowWrite: true,
      requireApproval: !flags.autoApprove,
      approvalMode: flags.autoApprove ? "never" : "risk-based",
      autoApproveRiskLevel: "MEDIUM",
      timeoutMs: flags.timeoutMs,
      // tool.execute() includes LLM generation internally, needs a longer timeout
      executeTimeoutMs: 10 * 60_000, // 10 minutes
      skipVerification: flags.skipVerify,
      enforceDevOpsAllowlist: !flags.allowAllPaths,
      maxRepairAttempts: flags.maxRepairAttempts,
    },
    approvalHandler: flags.autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    critic,
    progress: flags.jsonOutput
      ? undefined
      : {
          onVerificationFailed(taskId, errors) {
            p.log.warn(
              `Verification failed for ${pc.bold(taskId)} (${errors.length} error${errors.length === 1 ? "" : "s"}). Starting self-repair...`,
            );
          },
          onRepairAttempt(taskId, attempt, maxAttempts, errors) {
            p.log.info(
              `${pc.yellow("↻")} Repairing ${pc.bold(taskId)} (attempt ${attempt}/${maxAttempts}): ${errors[0] ?? "verification errors"}`,
            );
          },
          onVerificationPassed(taskId) {
            p.log.success(`Self-repair succeeded for ${pc.bold(taskId)}`);
          },
        },
  });

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const graph = buildTaskGraph(plan);
  const { executor, progress } = createExecutorWithCallbacks(
    tools,
    graph,
    ctx,
    flags.jsonOutput,
    flags.timeoutMs,
  );
  const planResult = await executor.execute(graph, {
    completedTaskIds,
    maxConcurrency: flags.maxConcurrency,
  });
  progress?.done();

  const applyCtx: ApplyContext = {
    root,
    plan,
    safeExecutor,
    allFilesCreated: [],
    allFilesModified: [],
    jsonOutput: flags.jsonOutput,
    verbose: ctx.globalOpts.verbose,
  };

  const { newResults, allFilesCreated, allFilesModified } = await processTaskResults(
    planResult,
    graph,
    toolMap,
    completedTaskIds,
    interrupted,
    applyCtx,
  );

  const durationMs = Date.now() - startTime;
  const status = computeExecutionStatus(newResults);

  await saveApplyResults(
    { newResults, allFilesCreated, allFilesModified, status },
    { root, plan, durationMs, replay: flags.replay, planSuccess: planResult.success },
  );

  if (flags.jsonOutput) {
    outputJsonResult(plan, status, newResults, allFilesCreated, allFilesModified, durationMs);
  } else {
    outputHumanResult(status, allFilesCreated, allFilesModified, durationMs);
  }

  if (status === "FAILURE") {
    throw new CLIError(ExitCode.GENERAL_ERROR, "All tasks failed.");
  } else if (status === "PARTIAL") {
    throw new CLIError(ExitCode.GENERAL_ERROR, "Some tasks failed. Use --resume to retry.");
  }

  if (!flags.jsonOutput) {
    displayTokenUsage(safeExecutor);
  }

  if (flags.installPackages && status === "SUCCESS") {
    runPostApplyInstall(root);
  }
}

export async function applyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");
  }

  // Pre-execute hook
  const hookOk = runHooks(root, "pre-execute", {}, { verbose: ctx.globalOpts.verbose });
  if (!hookOk) throw new CLIError(ExitCode.GENERAL_ERROR, "Pre-execute hook failed.");

  const flags = parseApplyFlags(args, ctx);
  const plan = resolvePlan(root, flags.planId, flags.jsonOutput);

  if (flags.singleTaskId) {
    validateSingleTask(plan, flags.singleTaskId);
  }

  const completedTaskIds = buildCompletedTaskIds(plan, flags);

  if (ctx.globalOpts.skill) {
    applyToolFilter(plan, completedTaskIds, ctx.globalOpts.skill, flags.jsonOutput);
  }

  displayPreFlightSummary(plan, completedTaskIds, flags.resume);
  displayVersionDriftWarning(plan);
  displayToolDriftWarnings(plan);
  displayImpactSummary(plan, completedTaskIds);

  const remainingTasks = plan.tasks.filter((t) => !completedTaskIds.has(t.id));

  if (flags.dryRun) {
    await executeDryRun(ctx, root, remainingTasks);
    return;
  }

  await confirmHighRiskPlan(plan, flags, ctx);
  await confirmApply(flags.autoApprove);

  acquireApplyLock(root);
  process.once("exit", () => releaseLock(root));
  const { interrupted, sigintHandler, sigtermHandler } = setupSignalHandlers(root);

  await handleGitDirtyCheck(root, flags);

  const startTime = Date.now();
  try {
    await executeApplyPlan(ctx, root, plan, flags, completedTaskIds, interrupted, startTime);
    // Post-execute hook (success)
    runHooks(root, "post-execute", {}, { verbose: ctx.globalOpts.verbose });
  } catch (err) {
    // On-error hook
    const errMsg = err instanceof Error ? err.message : String(err);
    runHooks(root, "on-error", { error: errMsg }, { verbose: ctx.globalOpts.verbose });
    throw err;
  } finally {
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("SIGTERM", sigtermHandler);
    releaseLock(root);
  }
}

function resolveInstallCommand(pm: string | undefined): string[] | null {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "install"];
    case "yarn":
      return ["yarn", "install"];
    case "npm":
      return ["npm", "install"];
    case "bun":
      return ["bun", "install"];
    case "poetry":
      return ["poetry", "install"];
    case "cargo":
      return ["cargo", "build"];
    case "go":
      return ["go", "mod", "download"];
    case "bundler":
      return ["bundle", "install"];
    case "pip":
      return ["pip", "install", "-r", "requirements.txt"];
    default:
      return null;
  }
}
