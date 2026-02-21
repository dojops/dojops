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
  loadSession,
  saveSession,
  saveExecution,
  appendAudit,
  PlanState,
} from "../state";

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
    process.exit(1);
  }

  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const planId = args.find((a) => !a.startsWith("-"));

  let plan: PlanState | null;
  if (planId) {
    plan = loadPlan(root, planId);
    if (!plan) {
      p.log.error(`Plan "${planId}" not found.`);
      process.exit(1);
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
      process.exit(1);
    }
  }

  // Show plan summary
  const createCount = plan.tasks.length;
  const summaryLines = [
    `${pc.bold("Plan:")}   ${plan.id}`,
    `${pc.bold("Goal:")}   ${plan.goal}`,
    `${pc.bold("Tasks:")}  ${createCount} tasks`,
    `${pc.bold("Risk:")}   ${plan.risk || "unknown"}`,
  ];
  p.note(summaryLines.join("\n"), "Plan Summary");

  if (!autoApprove) {
    const confirm = await p.confirm({ message: "Apply this plan?" });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  const startTime = Date.now();
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

  const planResult = await executor.execute(graph);

  const filesCreated: string[] = [];
  for (const taskResult of planResult.results) {
    if (taskResult.status !== "completed") continue;

    const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);
    if (!taskNode) continue;

    const tool = toolMap.get(taskNode.tool);
    if (!tool?.execute) continue;

    const execResult = await safeExecutor.executeTask(taskResult.taskId, tool, taskNode.input);

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
  const status = planResult.success ? "SUCCESS" : "FAILURE";

  // Save execution record
  saveExecution(root, {
    planId: plan.id,
    executedAt: new Date().toISOString(),
    status: status as "SUCCESS" | "FAILURE",
    filesCreated,
    filesModified: [],
    durationMs,
  });

  // Update plan status
  plan.approvalStatus = "APPLIED";
  const { savePlan } = await import("../state");
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

  if (planResult.success) {
    p.log.success(pc.bold("Plan applied successfully."));
  } else {
    p.log.error(pc.bold("Plan application failed."));
  }
}
