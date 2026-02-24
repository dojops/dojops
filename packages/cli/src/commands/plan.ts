import pc from "picocolors";
import * as p from "@clack/prompts";
import { decompose, PlannerExecutor } from "@dojops/planner";
import {
  SafeExecutor,
  AutoApproveHandler,
  CallbackApprovalHandler,
  ApprovalRequest,
} from "@dojops/executor";
import { createTools } from "@dojops/api";
import { CLIContext } from "../types";
import { hasFlag, stripFlags } from "../parser";
import { statusIcon, statusText, formatOutput, getOutputFileName } from "../formatter";
import { ExitCode } from "../exit-codes";
import {
  findProjectRoot,
  initProject,
  generatePlanId,
  savePlan,
  loadSession,
  saveSession,
  appendAudit,
  loadContext,
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

export async function planCommand(args: string[], ctx: CLIContext): Promise<void> {
  const executeMode = hasFlag(args, "--execute");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;

  const prompt = stripFlags(args, new Set(["--execute", "--yes"]), new Set<string>()).join(" ");

  if (!prompt) {
    p.log.error("No prompt provided.");
    p.log.info(`  ${pc.dim("$")} dojops plan <prompt>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const provider = ctx.getProvider();
  const tools = createTools(provider);

  // Load repo context for context-aware file placement
  const projectRoot = findProjectRoot();
  const repoContext = projectRoot ? loadContext(projectRoot) : null;

  const s = p.spinner();
  s.start("Decomposing goal into tasks...");
  const graph = await decompose(prompt, provider, tools, {
    repoContext: repoContext ?? undefined,
  });
  s.stop("Tasks decomposed.");

  // Display task graph
  const taskLines = graph.tasks.map((task) => {
    const deps = task.dependsOn.length ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    return `  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`;
  });
  p.note(taskLines.join("\n"), `${graph.goal} ${pc.dim(`(${graph.tasks.length} tasks)`)}`);

  // Save plan to .dojops/plans/
  let root = findProjectRoot();
  if (!root) {
    root = ctx.cwd;
    initProject(root);
  }

  const planId = generatePlanId();
  const savedPlan: PlanState = {
    id: planId,
    goal: graph.goal,
    createdAt: new Date().toISOString(),
    risk: "LOW",
    tasks: graph.tasks.map((t) => ({
      id: t.id,
      tool: t.tool,
      description: t.description,
      dependsOn: t.dependsOn,
    })),
    files: [],
    approvalStatus: "PENDING",
  };
  savePlan(root, savedPlan);

  // Update session
  const session = loadSession(root);
  session.currentPlan = planId;
  session.mode = "PLAN";
  saveSession(root, session);

  p.log.success(`Plan saved as ${pc.bold(planId)}`);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(graph, null, 2));
  }

  const startTime = Date.now();

  if (executeMode) {
    const safeExecutor = new SafeExecutor({
      policy: {
        allowWrite: true,
        requireApproval: !autoApprove,
        timeoutMs: 60_000,
      },
      approvalHandler: autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    });

    const toolMap = new Map(tools.map((t) => [t.name, t]));

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

    p.log.step("Executing approved tasks...");
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
      if (execResult.error) {
        p.log.error(`${pc.red("Error:")} ${execResult.error}`);
      }
    }

    const auditLog = safeExecutor.getAuditLog();
    if (auditLog.length > 0) {
      p.log.info(pc.dim(`Audit log: ${auditLog.length} entries`));
    }

    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: `plan --execute "${prompt}"`,
      action: "plan-execute",
      planId,
      status: planResult.success ? "success" : "failure",
      durationMs: Date.now() - startTime,
    });

    if (planResult.success) {
      p.log.success(pc.bold("Plan succeeded."));
    } else {
      p.log.error(pc.bold("Plan failed."));
    }
  } else {
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

    const result = await executor.execute(graph);

    if (result.success) {
      p.log.success(pc.bold("Plan succeeded."));
    } else {
      p.log.error(pc.bold("Plan failed."));
    }
    for (const r of result.results) {
      const errMsg = r.error ? `: ${pc.red(r.error)}` : "";
      p.log.message(
        `${statusIcon(r.status)} ${pc.blue(r.taskId)} ${statusText(r.status)}${errMsg}`,
      );
    }

    // Print generated output for completed tasks
    const completedResults = result.results.filter((r) => r.status === "completed" && r.output);
    if (completedResults.length > 0) {
      for (const r of completedResults) {
        const task = graph.tasks.find((t) => t.id === r.taskId);
        const data = r.output as Record<string, unknown>;
        const input = task?.input as Record<string, string> | undefined;
        const basePath = input?.projectPath ?? input?.outputPath ?? ".";
        const outputLines: string[] = [];

        outputLines.push(pc.bold(`[${r.taskId}] ${task?.tool ?? "unknown"}`));

        if (data.hcl) {
          outputLines.push(`  ${pc.green("Would write:")} ${pc.underline(`${basePath}/main.tf`)}`);
          outputLines.push(formatOutput(data.hcl as string));
        }
        if (data.yaml) {
          const fileName = getOutputFileName(task?.tool ?? "");
          outputLines.push(
            `  ${pc.green("Would write:")} ${pc.underline(`${basePath}/${fileName}`)}`,
          );
          outputLines.push(formatOutput(data.yaml as string));
        }
        if (data.chartYaml) {
          outputLines.push(
            `  ${pc.green("Would write:")} ${pc.underline(`${basePath}/Chart.yaml`)}`,
          );
          outputLines.push(formatOutput(data.chartYaml as string));
        }
        if (data.valuesYaml) {
          outputLines.push(
            `  ${pc.green("Would write:")} ${pc.underline(`${basePath}/values.yaml`)}`,
          );
          outputLines.push(formatOutput(data.valuesYaml as string));
        }

        p.note(outputLines.join("\n"), "Generated Output");
      }
      p.log.info(pc.dim("To write files to disk, use --execute instead of plan"));
    }

    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: process.env.USER ?? "unknown",
      command: `plan "${prompt}"`,
      action: "plan",
      planId,
      status: result.success ? "success" : "failure",
      durationMs: Date.now() - startTime,
    });
  }
}
