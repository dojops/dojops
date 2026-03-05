import { execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { DeterministicProvider } from "@dojops/core";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createToolRegistry } from "@dojops/tool-registry";
import { PlannerExecutor } from "@dojops/planner";
import { CLIContext } from "../types";
import { hasFlag, extractFlagValue } from "../parser";
import { statusIcon, statusText, riskColor, wrapForNote } from "../formatter";
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
import { ExitCode, CLIError } from "../exit-codes";
import { cliApprovalHandler } from "../approval";
import { getDriftWarnings } from "../drift-warning";
import { validateReplayIntegrity, checkToolIntegrity } from "./replay-validator";
import { readExistingToolFile } from "../tool-file-map";

export async function applyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");
  }

  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const dryRun = hasFlag(args, "--dry-run");
  const resume = hasFlag(args, "--resume");
  const retry = hasFlag(args, "--retry");
  const replay = hasFlag(args, "--replay");
  const installPackages = hasFlag(args, "--install-packages");
  const skipVerify = hasFlag(args, "--skip-verify");
  const force = hasFlag(args, "--force");
  const allowAllPaths = hasFlag(args, "--allow-all-paths");
  const timeoutArg = extractFlagValue(args, "--timeout");
  const timeoutMs = timeoutArg ? Number.parseInt(timeoutArg, 10) * 1000 : 60_000; // --timeout in seconds
  if (timeoutArg && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --timeout value: "${timeoutArg}". Must be a positive number (seconds).`,
    );
  }
  const jsonOutput = ctx.globalOpts.output === "json";
  const singleTaskId = extractFlagValue(args, "--task");
  const planId = args.find((a) => !a.startsWith("-") && a !== singleTaskId);

  let plan: PlanState | null;
  if (planId) {
    plan = loadPlan(root, planId);
    if (!plan) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Plan "${planId}" not found.`);
    }
  } else {
    // Try session.currentPlan first, then latest
    const session = loadSession(root);
    if (session.currentPlan) {
      plan = loadPlan(root, session.currentPlan);
      // UX #14: Show which plan was auto-selected
      if (plan && !jsonOutput) {
        p.log.info(`Using session plan: ${pc.cyan(plan.id)}`);
      }
    } else {
      plan = getLatestPlan(root);
      // UX #14: Show which plan was auto-selected
      if (plan && !jsonOutput) {
        p.log.info(`Using latest plan: ${pc.cyan(plan.id)}`);
      }
    }
    if (!plan) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        "No plan found. Run `dojops plan <prompt>` first.",
      );
    }
  }

  // --task <id>: run only a single task (mark all others as completed)
  if (singleTaskId) {
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

  // Build skip set for resume
  let completedTaskIds = new Set<string>();
  if (singleTaskId) {
    // Mark all tasks except the target as completed so only it runs
    completedTaskIds = new Set(plan.tasks.filter((t) => t.id !== singleTaskId).map((t) => t.id));
  } else if (resume && plan.results?.length) {
    // FEAT #3: --retry also retries failed tasks (not just pending ones)
    completedTaskIds = new Set(
      plan.results
        .filter((r) => {
          if (r.status === "completed" && r.executionStatus === "completed") return true;
          // With --retry, don't skip failed tasks — let them re-run
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
  } else if (resume) {
    p.log.warn("No previous results found. Running full execution.");
  }

  // --tool flag: skip tasks not matching the specified tool
  if (ctx.globalOpts.tool) {
    const toolFilter = ctx.globalOpts.tool;
    const matchingTools = plan.tasks.filter((t) => t.tool === toolFilter);
    if (matchingTools.length === 0) {
      const usedTools = [...new Set(plan.tasks.map((t) => t.tool))].join(", ");
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `No tasks use tool "${toolFilter}". Tools in this plan: ${usedTools}`,
      );
    }
    const skippedIds = plan.tasks.filter((t) => t.tool !== toolFilter).map((t) => t.id);
    for (const id of skippedIds) {
      completedTaskIds.add(id);
    }
    if (!jsonOutput && skippedIds.length > 0) {
      p.log.info(
        `Filtering by tool: ${pc.bold(toolFilter)} — skipping ${skippedIds.length} task(s)`,
      );
    }
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
  summaryLines.push(
    `${pc.bold("Tools:")}  ${toolsUsed.join(", ")}`,
    "",
    pc.bold("Task breakdown:"),
  );

  for (const task of plan.tasks) {
    const isCompleted = completedTaskIds.has(task.id);
    const icon = isCompleted ? pc.green("✓") : pc.cyan("○");
    const deps = task.dependsOn.length > 0 ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    summaryLines.push(
      `  ${icon} ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`,
    );
  }

  p.note(
    wrapForNote(summaryLines.join("\n")),
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
  // Estimate file count: helm produces 2+ files, most tools produce 1
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

  if (dryRun) {
    p.log.info(pc.dim("Dry run — previewing what would be generated (no files written)."));

    // F-5: Run generation for each task and display preview
    try {
      const provider = ctx.getProvider();
      const registry = createToolRegistry(provider, root);
      const tools = registry.getAll();

      for (const task of remainingTasks) {
        const tool = tools.find((t) => t.name === task.tool);
        if (!tool) {
          p.log.warn(`Skipping ${pc.bold(task.id)}: tool "${task.tool}" not found.`);
          continue;
        }

        try {
          // Use structured task input when available, fallback to prompt-only
          const input =
            task.input && Object.keys(task.input).length > 0
              ? task.input
              : { prompt: task.description };
          const result = await tool.generate(input);
          const preview = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          const truncated =
            preview.length > 5000
              ? preview.slice(0, 5000) + "\n... (truncated — use --output json for full content)"
              : preview;
          p.note(wrapForNote(truncated), `${task.id} — ${task.tool}: ${task.description}`);
        } catch (err) {
          p.log.warn(
            `${pc.bold(task.id)} generation failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      p.log.warn(`Could not preview tasks: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // HIGH risk gate: require explicit confirmation even with --yes
  if (plan.risk === "HIGH" && !force) {
    p.log.warn(pc.bold(pc.red("This plan is classified as HIGH risk.")));
    if (ctx.globalOpts.nonInteractive) {
      // In non-interactive mode (CI), HIGH risk plans require --force
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        "HIGH risk plans require --force in non-interactive mode.",
      );
    } else if (autoApprove) {
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
    throw new CLIError(
      ExitCode.LOCK_CONFLICT,
      `Operation locked by PID ${info?.pid} (${info?.operation})`,
    );
  }

  // Ensure lock is released even on abrupt process.exit() calls
  process.once("exit", () => releaseLock(root));

  // FB6: Graceful SIGINT/SIGTERM handling with named handlers for cleanup
  let interrupted = false;
  const onSignal = (signal: string) => {
    if (interrupted) {
      // Second signal → force exit
      releaseLock(root);
      process.exit(ExitCode.GENERAL_ERROR);
    }
    interrupted = true;
    p.log.warn(`\nReceived ${signal}. Finishing current task before stopping...`);
    p.log.info("Press Ctrl+C again to force exit.");
  };
  const sigintHandler = () => onSignal("SIGINT");
  const sigtermHandler = () => onSignal("SIGTERM");
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

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
    // Replay integrity failures always hard-fail unless --force is used.
    // The --yes flag must NOT bypass this check since deterministic replay
    // requires an exact environment match to produce meaningful results.
    if (replay) {
      const result = validateReplayIntegrity(plan, provider.name, ctx.globalOpts.model, registry);
      if (result.valid) {
        p.log.success("Replay validation passed.");
      } else {
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
    }

    // Validate tool integrity on resume
    if (resume) {
      const { mismatches: toolMismatches, hasMismatches } = checkToolIntegrity(plan.tasks, tools);

      if (hasMismatches) {
        p.log.warn(pc.bold("Tool integrity warnings:"));
        for (const msg of toolMismatches) {
          p.log.warn(`  ${pc.yellow("!")} ${msg}`);
        }

        if (!autoApprove) {
          const proceed = await p.confirm({
            message: "Tools have changed since this plan was created. Continue anyway?",
          });
          if (p.isCancel(proceed) || !proceed) {
            p.cancel("Aborted due to tool integrity mismatch.");
            releaseLock(root);
            throw new CLIError(ExitCode.VALIDATION_ERROR);
          }
        }
      }
    }

    const safeExecutor = new SafeExecutor({
      policy: {
        allowWrite: true,
        requireApproval: !autoApprove,
        timeoutMs,
        skipVerification: skipVerify,
        enforceDevOpsAllowlist: !allowAllPaths,
      },
      approvalHandler: autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    });

    const toolMap = new Map(tools.map((t) => [t.name, t]));

    // Reconstruct task graph for executor
    const graph = {
      goal: plan.goal,
      tasks: plan.tasks.map((t) => {
        const input = { ...(t.input ?? {}) };
        // BUG #3: Enrich task inputs with existingContent if the target file exists
        if (!input.existingContent) {
          const existing = readExistingToolFile(t.tool, root);
          if (existing) {
            input.existingContent = existing.content;
          }
        }
        return {
          id: t.id,
          tool: t.tool,
          description: t.description,
          dependsOn: t.dependsOn,
          input,
        };
      }),
    };

    const taskTimers = new Map<string, number>();
    const executor = new PlannerExecutor(tools, {
      taskStart(id, desc) {
        p.log.step(`Running ${pc.blue(id)}: ${desc}`);
        taskTimers.set(id, Date.now());
        if (ctx.globalOpts.verbose) {
          const task = graph.tasks.find((t) => t.id === id);
          p.log.info(
            `  Tool: ${pc.bold(task?.tool ?? "unknown")}, deps: [${task?.dependsOn.join(", ") ?? ""}]`,
          );
        }
      },
      taskEnd(id, status, error) {
        const elapsed = taskTimers.has(id) ? Date.now() - taskTimers.get(id)! : 0;
        if (error) {
          p.log.error(`${pc.blue(id)}: ${statusText(status)} - ${pc.red(error)}`);
        } else {
          // BUG #2: Use "generated" instead of "completed" since SafeExecutor hasn't run yet
          const label = status === "completed" ? "generated" : statusText(status);
          p.log.info(`${pc.blue(id)}: ${label}`);
        }
        if (ctx.globalOpts.verbose) {
          p.log.info(`  Generated in ${elapsed}ms`);
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
      // Check if user interrupted
      if (interrupted) {
        p.log.warn("Apply interrupted by user. Partial results saved.");
        break;
      }

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

      // Build tool metadata for audit enrichment
      const taskDef = plan.tasks.find((t) => t.id === taskResult.taskId);
      const metadata: Record<string, unknown> = {};
      if (taskDef?.toolType) metadata.toolType = taskDef.toolType;
      if (taskDef?.toolVersion) metadata.toolVersion = taskDef.toolVersion;
      if (taskDef?.toolHash) metadata.toolHash = taskDef.toolHash;
      if (taskDef?.toolSource) metadata.toolSource = taskDef.toolSource;

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

      if (!jsonOutput) {
        const approval =
          execResult.approval === "approved"
            ? pc.green(execResult.approval)
            : pc.yellow(execResult.approval);
        const icon = statusIcon(execResult.status);
        p.log.message(
          `${icon} ${pc.blue(execResult.taskId)} ${statusText(execResult.status)} (approval: ${approval})`,
        );

        // Render verification results
        if (ctx.globalOpts.verbose && execResult.verification) {
          p.log.info(
            `  Verification: ${execResult.verification.passed ? pc.green("passed") : pc.red("failed")} (${execResult.verification.issues.length} issue(s))`,
          );
        }
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
    }

    const durationMs = Date.now() - startTime;
    const allCompleted = newResults.every(
      (r) => r.status === "completed" && (!r.executionStatus || r.executionStatus === "completed"),
    );
    const someCompleted = newResults.some(
      (r) => r.status === "completed" && (!r.executionStatus || r.executionStatus === "completed"),
    );
    const statusPartial = someCompleted ? "PARTIAL" : "FAILURE";
    const status = allCompleted ? "SUCCESS" : statusPartial;

    // Save execution record
    saveExecution(root, {
      planId: plan.id,
      executedAt: new Date().toISOString(),
      status: status,
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
      user: getCurrentUser(),
      command: `apply${replay ? " --replay" : ""} ${plan.id}`,
      action: "apply",
      planId: plan.id,
      status: planResult.success ? "success" : "failure",
      durationMs,
    });

    if (jsonOutput) {
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
    } else if (allCompleted) {
      p.log.success(pc.bold("Plan applied successfully."));
    } else if (plan.approvalStatus === "PARTIAL") {
      p.log.warn(pc.bold("Plan partially applied. Use `dojops apply --resume` to continue."));
    } else {
      p.log.error(pc.bold("Plan application failed."));
    }

    // UX #12 / FEAT: Non-zero exit code when apply fails
    if (status === "FAILURE") {
      throw new CLIError(ExitCode.GENERAL_ERROR, "All tasks failed.");
    } else if (status === "PARTIAL") {
      throw new CLIError(ExitCode.GENERAL_ERROR, "Some tasks failed. Use --resume to retry.");
    }

    // Token budget display (verbose mode)
    if (ctx.globalOpts.verbose) {
      const tokenUsage = safeExecutor.getTokenUsage();
      if (tokenUsage.total > 0) {
        p.log.info(
          `Token usage: ${tokenUsage.prompt.toLocaleString()} prompt + ` +
            `${tokenUsage.completion.toLocaleString()} completion = ` +
            `${tokenUsage.total.toLocaleString()} total`,
        );
      }
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
