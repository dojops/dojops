import { execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { DeterministicProvider } from "@dojops/core";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createToolRegistry } from "@dojops/tool-registry";
import { PlannerExecutor } from "@dojops/planner";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import { statusIcon, statusText, riskColor } from "../formatter";
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
} from "../state";
import { ExitCode } from "../exit-codes";
import { cliApprovalHandler } from "../approval";
import { getDojopsVersion } from "../state";
import { getDriftWarnings } from "../drift-warning";
import { validateReplayIntegrity, checkPluginIntegrity } from "./replay-validator";

export async function applyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .dojops/ project found. Run `dojops init` first.");
    process.exit(ExitCode.NO_PROJECT);
  }

  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const dryRun = hasFlag(args, "--dry-run");
  const resume = hasFlag(args, "--resume");
  const replay = hasFlag(args, "--replay");
  const installPackages = hasFlag(args, "--install-packages");
  const skipVerify = hasFlag(args, "--skip-verify");
  const force = hasFlag(args, "--force");
  const allowAllPaths = hasFlag(args, "--allow-all-paths");
  const planId = args.find((a) => !a.startsWith("-"));

  let plan: PlanState | null;
  if (planId) {
    plan = loadPlan(root, planId);
    if (!plan) {
      p.log.error(`Plan "${planId}" not found.`);
      process.exit(ExitCode.VALIDATION_ERROR);
    }
  } else {
    // Try session.currentPlan first, then latest
    const session = loadSession(root);
    if (session.currentPlan) {
      plan = loadPlan(root, session.currentPlan);
    } else {
      plan = getLatestPlan(root);
    }
    if (!plan) {
      p.log.error("No plan found. Run `dojops plan <prompt>` first.");
      process.exit(ExitCode.VALIDATION_ERROR);
    }
  }

  // Build skip set for resume
  let completedTaskIds = new Set<string>();
  if (resume && plan.results?.length) {
    completedTaskIds = new Set(
      plan.results
        .filter((r) => r.status === "completed" && r.executionStatus === "completed")
        .map((r) => r.taskId),
    );
    if (completedTaskIds.size > 0) {
      p.log.info(`Resuming: skipping ${completedTaskIds.size} completed task(s)`);
    }
  } else if (resume) {
    p.log.warn("No previous results found. Running full execution.");
  }

  // Pre-flight summary
  const totalCount = plan.tasks.length;
  const remainingCount = totalCount - completedTaskIds.size;

  const summaryLines = [
    `${pc.bold("Plan:")}   ${plan.id}`,
    `${pc.bold("Goal:")}   ${plan.goal}`,
    `${pc.bold("Tasks:")}  ${resume && completedTaskIds.size > 0 ? `${remainingCount} remaining / ${totalCount} total` : `${totalCount} tasks`}`,
    `${pc.bold("Risk:")}   ${plan.risk || "unknown"}`,
  ];

  // Collect unique tools used
  const toolsUsed = [...new Set(plan.tasks.map((t) => t.tool))];
  summaryLines.push(`${pc.bold("Tools:")}  ${toolsUsed.join(", ")}`);

  summaryLines.push("");
  summaryLines.push(pc.bold("Task breakdown:"));

  for (const task of plan.tasks) {
    const isCompleted = completedTaskIds.has(task.id);
    const icon = isCompleted ? pc.green("✓") : pc.cyan("○");
    const deps = task.dependsOn.length > 0 ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    summaryLines.push(
      `  ${icon} ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`,
    );
  }

  p.note(
    summaryLines.join("\n"),
    resume && completedTaskIds.size > 0 ? "Pre-flight: Resume" : "Pre-flight Summary",
  );

  // Context drift warning (informational, non-blocking)
  if (plan.executionContext?.dojopsVersion) {
    const currentVersion = getDojopsVersion();
    if (plan.executionContext.dojopsVersion !== currentVersion) {
      p.log.warn(
        `Plan was created with DojOps v${plan.executionContext.dojopsVersion}, ` +
          `current is v${currentVersion}.`,
      );
    }
  }

  // Drift awareness warnings
  const driftWarnings = getDriftWarnings(toolsUsed);
  if (driftWarnings.length > 0) {
    for (const dw of driftWarnings) {
      p.log.warn(`${pc.yellow(dw.tool)}: ${dw.message}`);
    }
  }

  // Change impact summary
  const remainingTasks = plan.tasks.filter((t) => !completedTaskIds.has(t.id));
  const estimatedFiles = remainingTasks.length;
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

  if (dryRun) {
    p.log.info(pc.dim("Dry run — no changes will be made."));
    return;
  }

  // HIGH risk gate: always require explicit confirmation even with --yes
  if (plan.risk === "HIGH" && !force) {
    p.log.warn(pc.bold(pc.red("This plan is classified as HIGH risk.")));
    if (autoApprove) {
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

  if (!autoApprove) {
    const confirm = await p.confirm({ message: "Apply this plan?" });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  if (!acquireLock(root, "apply")) {
    const { info } = isLocked(root);
    p.log.error(`Operation locked by PID ${info?.pid} (${info?.operation})`);
    process.exit(ExitCode.LOCK_CONFLICT);
  }

  // Git dirty working tree check
  if (!force) {
    const gitStatus = checkGitDirty(root);
    if (gitStatus.dirty) {
      p.log.warn(pc.bold("Working tree has uncommitted changes:"));
      for (const f of gitStatus.files.slice(0, 10)) {
        p.log.warn(`  ${pc.yellow(f)}`);
      }
      if (gitStatus.files.length > 10) {
        p.log.warn(pc.dim(`  ...and ${gitStatus.files.length - 10} more`));
      }

      if (autoApprove) {
        p.log.warn("Proceeding despite dirty tree (--yes).");
      } else {
        const proceed = await p.confirm({
          message: "Continue with uncommitted changes?",
        });
        if (p.isCancel(proceed) || !proceed) {
          p.cancel("Commit or stash changes first, or use --force to skip this check.");
          releaseLock(root);
          process.exit(0);
        }
      }
    }
  }

  const startTime = Date.now();
  try {
    let provider = ctx.getProvider();
    if (replay) {
      provider = new DeterministicProvider(provider);
    }
    const registry = createToolRegistry(provider, root);
    const tools = registry.getAll();

    // Replay validation: provider/model/systemPromptHash match
    if (replay) {
      const result = validateReplayIntegrity(plan, provider.name, ctx.globalOpts.model, registry);
      if (!result.valid) {
        p.log.warn(pc.bold("Replay integrity check failed:"));
        for (const m of result.mismatches) {
          const taskLabel = m.taskId ? ` [task ${m.taskId}]` : "";
          p.log.warn(
            `  ${pc.yellow("!")} ${m.field}${taskLabel}: expected "${m.expected}", got "${m.actual}"`,
          );
        }
        if (!autoApprove) {
          p.cancel("Replay aborted due to environment mismatch. Use --yes to force.");
          releaseLock(root);
          process.exit(ExitCode.VALIDATION_ERROR);
        }
        p.log.warn("Continuing despite replay mismatches (--yes).");
      } else {
        p.log.success("Replay validation passed.");
      }
    }

    // Validate plugin integrity on resume
    if (resume) {
      const { mismatches: pluginMismatches, hasMismatches } = checkPluginIntegrity(
        plan.tasks,
        tools,
      );

      if (hasMismatches) {
        p.log.warn(pc.bold("Plugin integrity warnings:"));
        for (const msg of pluginMismatches) {
          p.log.warn(`  ${pc.yellow("!")} ${msg}`);
        }

        if (!autoApprove) {
          const proceed = await p.confirm({
            message: "Plugins have changed since this plan was created. Continue anyway?",
          });
          if (p.isCancel(proceed) || !proceed) {
            p.cancel("Aborted due to plugin integrity mismatch.");
            releaseLock(root);
            process.exit(ExitCode.VALIDATION_ERROR);
          }
        }
      }
    }

    const safeExecutor = new SafeExecutor({
      policy: {
        allowWrite: true,
        requireApproval: !autoApprove,
        timeoutMs: 60_000,
        skipVerification: skipVerify,
        enforceDevOpsAllowlist: !allowAllPaths,
      },
      approvalHandler: autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    });

    const toolMap = new Map(tools.map((t) => [t.name, t]));

    // Reconstruct task graph for executor
    const graph = {
      goal: plan.goal,
      tasks: plan.tasks.map((t) => ({
        id: t.id,
        tool: t.tool,
        description: t.description,
        dependsOn: t.dependsOn,
        input: t.input ?? {},
      })),
    };

    const executor = new PlannerExecutor(tools, {
      taskStart(id, desc) {
        p.log.step(`Running ${pc.blue(id)}: ${desc}`);
      },
      taskEnd(id, status, error) {
        if (error) {
          p.log.error(`${pc.blue(id)}: ${statusText(status)} - ${pc.red(error)}`);
        } else {
          p.log.success(`${pc.blue(id)}: ${statusText(status)}`);
        }
      },
    });

    const planResult = await executor.execute(graph, { completedTaskIds });

    const allFilesCreated: string[] = [];
    const allFilesModified: string[] = [];
    const newResults: Array<{
      taskId: string;
      status: string;
      output?: unknown;
      error?: string;
      filesCreated?: string[];
      executionStatus?: string;
      executionApproval?: string;
    }> = [];

    for (const taskResult of planResult.results) {
      // For resumed-completed tasks, preserve previous result
      if (completedTaskIds.has(taskResult.taskId)) {
        const prev = plan.results?.find((r) => r.taskId === taskResult.taskId);
        if (prev) newResults.push(prev);
        continue;
      }

      const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);

      if (taskResult.status !== "completed" || !taskNode) {
        newResults.push({
          taskId: taskResult.taskId,
          status: taskResult.status,
          error: taskResult.error,
        });
        continue;
      }

      const tool = toolMap.get(taskNode.tool);
      if (!tool?.execute) {
        newResults.push({
          taskId: taskResult.taskId,
          status: taskResult.status,
          output: taskResult.output,
        });
        continue;
      }

      // Build plugin metadata for audit enrichment
      const taskDef = plan.tasks.find((t) => t.id === taskResult.taskId);
      const metadata: Record<string, unknown> = {};
      if (taskDef?.toolType) metadata.toolType = taskDef.toolType;
      if (taskDef?.pluginVersion) metadata.pluginVersion = taskDef.pluginVersion;
      if (taskDef?.pluginHash) metadata.pluginHash = taskDef.pluginHash;
      if (taskDef?.pluginSource) metadata.pluginSource = taskDef.pluginSource;

      const execResult = await safeExecutor.executeTask(
        taskResult.taskId,
        tool,
        taskNode.input,
        Object.keys(metadata).length > 0 ? metadata : undefined,
      );
      const taskFiles = execResult.auditLog?.filesWritten ?? [];
      const taskModified = execResult.auditLog?.filesModified ?? [];
      allFilesCreated.push(...taskFiles);
      allFilesModified.push(...taskModified);

      newResults.push({
        taskId: taskResult.taskId,
        status: taskResult.status,
        output: taskResult.output,
        filesCreated: taskFiles,
        executionStatus: execResult.status,
        executionApproval: execResult.approval,
        error: execResult.error,
      });

      const approval =
        execResult.approval === "approved"
          ? pc.green(execResult.approval)
          : pc.yellow(execResult.approval);
      const icon = statusIcon(execResult.status);
      p.log.message(
        `${icon} ${pc.blue(execResult.taskId)} ${statusText(execResult.status)} (approval: ${approval})`,
      );

      // Render verification issues if present
      if (execResult.verification?.issues.length) {
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
    }

    const durationMs = Date.now() - startTime;
    const allCompleted = newResults.every(
      (r) => r.status === "completed" && (!r.executionStatus || r.executionStatus === "completed"),
    );
    const status = allCompleted ? "SUCCESS" : planResult.success ? "PARTIAL" : "FAILURE";

    // Save execution record
    saveExecution(root, {
      planId: plan.id,
      executedAt: new Date().toISOString(),
      status: status as "SUCCESS" | "FAILURE" | "PARTIAL",
      filesCreated: allFilesCreated,
      filesModified: allFilesModified,
      durationMs,
    });

    // Update plan status and results
    plan.results = newResults;
    plan.approvalStatus = allCompleted ? "APPLIED" : "PARTIAL";
    savePlan(root, plan);

    // Update session
    const session = loadSession(root);
    session.mode = "IDLE";
    saveSession(root, session);

    // Audit
    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: `apply${replay ? " --replay" : ""} ${plan.id}`,
      action: "apply",
      planId: plan.id,
      status: planResult.success ? "success" : "failure",
      durationMs,
    });

    if (allCompleted) {
      p.log.success(pc.bold("Plan applied successfully."));
    } else if (plan.approvalStatus === "PARTIAL") {
      p.log.warn(pc.bold("Plan partially applied. Use `dojops apply --resume` to continue."));
    } else {
      p.log.error(pc.bold("Plan application failed."));
    }

    // Post-apply: install packages if requested and plan succeeded
    if (installPackages && allCompleted) {
      const repoCtx = loadContext(root);
      const pm = repoCtx?.packageManager?.name;
      const installCmd = resolveInstallCommand(pm);

      if (installCmd) {
        const installSpinner = p.spinner();
        installSpinner.start(`Running ${installCmd.join(" ")}...`);
        try {
          execFileSync(installCmd[0], installCmd.slice(1), {
            cwd: root,
            encoding: "utf-8",
            timeout: 120_000,
            stdio: "pipe",
          });
          installSpinner.stop(`${installCmd.join(" ")} completed.`);
        } catch (err) {
          installSpinner.stop(`${installCmd.join(" ")} failed.`);
          const msg = err instanceof Error ? err.message : String(err);
          p.log.warn(`Package install failed: ${msg}`);
        }
      } else {
        p.log.info(pc.dim("No package manager detected — skipping install."));
      }
    }
  } finally {
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
