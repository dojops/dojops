import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  SafeExecutor,
  AutoApproveHandler,
  CallbackApprovalHandler,
  ApprovalRequest,
} from "@odaops/executor";
import { createTools } from "@odaops/api";
import { PlannerExecutor } from "@odaops/planner";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import { statusIcon, statusText } from "../formatter";
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
  PlanState,
} from "../state";
import { ExitCode } from "../exit-codes";

function cliApprovalHandler(): CallbackApprovalHandler {
  return new CallbackApprovalHandler(async (request: ApprovalRequest) => {
    const body = [
      `${pc.bold("Task:")}    ${request.taskId}`,
      `${pc.bold("Tool:")}    ${request.toolName}`,
      `${pc.bold("Summary:")} ${request.preview.summary}`,
      ...(request.preview.filesCreated.length > 0
        ? [`${pc.bold("Creates:")} ${request.preview.filesCreated.join(", ")}`]
        : []),
      ...(request.preview.filesModified.length > 0
        ? [`${pc.bold("Modifies:")} ${request.preview.filesModified.join(", ")}`]
        : []),
    ];
    p.note(body.join("\n"), pc.yellow("Approval Required"));

    const approved = await p.confirm({ message: "Approve this execution?" });
    if (p.isCancel(approved)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
    return approved ? "approved" : "denied";
  });
}

export async function applyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .oda/ project found. Run `oda init` first.");
    process.exit(ExitCode.NO_PROJECT);
  }

  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const dryRun = hasFlag(args, "--dry-run");
  const resume = hasFlag(args, "--resume");
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
      p.log.error("No plan found. Run `oda plan <prompt>` first.");
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

  // Show plan summary
  const totalCount = plan.tasks.length;
  const remainingCount = totalCount - completedTaskIds.size;
  const summaryLines = [
    `${pc.bold("Plan:")}   ${plan.id}`,
    `${pc.bold("Goal:")}   ${plan.goal}`,
    `${pc.bold("Tasks:")}  ${resume && completedTaskIds.size > 0 ? `${remainingCount} remaining / ${totalCount} total` : `${totalCount} tasks`}`,
    `${pc.bold("Risk:")}   ${plan.risk || "unknown"}`,
  ];
  p.note(
    summaryLines.join("\n"),
    resume && completedTaskIds.size > 0 ? "Resume Summary" : "Plan Summary",
  );

  if (dryRun) {
    for (const task of plan.tasks) {
      p.log.message(`  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}`);
    }
    p.log.info(pc.dim("Dry run — no changes will be made."));
    return;
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

  const startTime = Date.now();
  try {
    const provider = ctx.getProvider();
    const tools = createTools(provider);

    const safeExecutor = new SafeExecutor({
      policy: {
        allowWrite: true,
        requireApproval: !autoApprove,
        timeoutMs: 60_000,
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
        input: {},
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

      const execResult = await safeExecutor.executeTask(taskResult.taskId, tool, taskNode.input);
      const taskFiles = execResult.auditLog?.filesWritten ?? [];
      allFilesCreated.push(...taskFiles);

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
      filesModified: [],
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
      command: `apply ${plan.id}`,
      action: "apply",
      planId: plan.id,
      status: planResult.success ? "success" : "failure",
      durationMs,
    });

    if (allCompleted) {
      p.log.success(pc.bold("Plan applied successfully."));
    } else if (plan.approvalStatus === "PARTIAL") {
      p.log.warn(pc.bold("Plan partially applied. Use `oda apply --resume` to continue."));
    } else {
      p.log.error(pc.bold("Plan application failed."));
    }
  } finally {
    releaseLock(root);
  }
}
