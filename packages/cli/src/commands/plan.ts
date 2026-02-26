import pc from "picocolors";
import * as p from "@clack/prompts";
import { decompose, PlannerExecutor } from "@dojops/planner";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { hasFlag, stripFlags } from "../parser";
import { statusIcon, statusText, formatOutput, getOutputFileName } from "../formatter";
import { ExitCode } from "../exit-codes";
import { cliApprovalHandler } from "../approval";
import { classifyPlanRisk } from "../risk-classifier";
import crypto from "node:crypto";
import {
  findProjectRoot,
  initProject,
  generatePlanId,
  savePlan,
  loadSession,
  saveSession,
  appendAudit,
  saveExecution,
  loadContext,
  getDojopsVersion,
  acquireLock,
  releaseLock,
  isLocked,
  PlanState,
} from "../state";

export async function planCommand(args: string[], ctx: CLIContext): Promise<void> {
  const executeMode = hasFlag(args, "--execute");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const skipVerify = hasFlag(args, "--skip-verify");

  const prompt = stripFlags(
    args,
    new Set(["--execute", "--yes", "--skip-verify", "--force"]),
    new Set<string>(),
  ).join(" ");

  if (!prompt) {
    p.log.error("No prompt provided.");
    p.log.info(`  ${pc.dim("$")} dojops plan <prompt>`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const provider = ctx.getProvider();

  // Load repo context for context-aware file placement
  const projectRoot = findProjectRoot();
  const registry = createToolRegistry(provider, projectRoot ?? undefined);
  const tools = registry.getAll();
  const repoContext = projectRoot ? loadContext(projectRoot) : null;

  const s = p.spinner();
  s.start("Decomposing goal into tasks...");
  let graph;
  try {
    graph = await decompose(prompt, provider, tools, {
      repoContext: repoContext ?? undefined,
    });
  } catch (err) {
    s.stop("Decomposition failed.");
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(ExitCode.GENERAL_ERROR);
  }
  s.stop("Tasks decomposed.");

  // Enrich tasks with plugin metadata
  for (const task of graph.tasks) {
    const meta = registry.getToolMetadata(task.tool);
    if (meta) {
      task.toolType = meta.toolType;
      if (meta.toolType === "plugin") {
        task.pluginVersion = meta.pluginVersion;
        task.pluginHash = meta.pluginHash;
        task.pluginSource = meta.pluginSource as "global" | "project" | undefined;
        task.systemPromptHash = meta.systemPromptHash;
      }
    }
  }

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
    risk: classifyPlanRisk(graph.tasks),
    tasks: graph.tasks.map((t) => ({
      id: t.id,
      tool: t.tool,
      description: t.description,
      dependsOn: t.dependsOn,
      input: t.input as Record<string, unknown> | undefined,
      toolType: t.toolType,
      pluginVersion: t.pluginVersion,
      pluginHash: t.pluginHash,
      pluginSource: t.pluginSource,
      systemPromptHash: t.systemPromptHash,
    })),
    files: [],
    approvalStatus: "PENDING",
    executionContext: {
      provider: provider.name,
      model: ctx.globalOpts.model,
      temperature: ctx.globalOpts.temperature,
      dojopsVersion: getDojopsVersion(),
      policySnapshot: crypto
        .createHash("sha256")
        .update(JSON.stringify({ skipVerification: skipVerify }))
        .digest("hex")
        .slice(0, 16),
      toolVersions: Object.fromEntries(
        graph.tasks.map((t) => {
          const meta = registry.getToolMetadata(t.tool);
          return [t.tool, meta?.pluginVersion ?? "built-in"];
        }),
      ),
    },
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
    // HIGH risk gate: always require explicit confirmation even with --yes
    const force = hasFlag(args, "--force");
    if ((savedPlan.risk === "HIGH" || savedPlan.risk === "CRITICAL") && !force) {
      p.log.warn(pc.bold(pc.red(`This plan is classified as ${savedPlan.risk} risk.`)));
      if (autoApprove) {
        p.log.warn(
          `${savedPlan.risk} risk plans require explicit confirmation. Use --force to bypass.`,
        );
      }
      const highRiskConfirm = await p.confirm({
        message: `This is a ${savedPlan.risk} risk plan. Are you sure you want to proceed?`,
      });
      if (p.isCancel(highRiskConfirm) || !highRiskConfirm) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
    }

    if (!autoApprove) {
      const confirm = await p.confirm({ message: "Execute this plan?" });
      if (p.isCancel(confirm) || !confirm) {
        p.cancel("Cancelled.");
        process.exit(0);
      }
    }

    if (!acquireLock(root, "plan-execute")) {
      const { info } = isLocked(root);
      p.log.error(`Operation locked by PID ${info?.pid} (${info?.operation})`);
      process.exit(ExitCode.LOCK_CONFLICT);
    }
    process.once("exit", () => releaseLock(root));

    const safeExecutor = new SafeExecutor({
      policy: {
        allowWrite: true,
        requireApproval: !autoApprove,
        timeoutMs: 60_000,
        skipVerification: skipVerify,
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
    const allFilesCreated: string[] = [];
    const allFilesModified: string[] = [];

    for (const taskResult of planResult.results) {
      if (taskResult.status !== "completed") continue;

      const taskNode = graph.tasks.find((t) => t.id === taskResult.taskId);
      if (!taskNode) continue;

      const tool = toolMap.get(taskNode.tool);
      if (!tool?.execute) continue;

      // Build plugin metadata for audit enrichment
      const taskDef = savedPlan.tasks.find((t) => t.id === taskResult.taskId);
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

    // Save execution record for rollback support
    const durationMs = Date.now() - startTime;
    saveExecution(root, {
      planId,
      executedAt: new Date().toISOString(),
      status: planResult.success ? "SUCCESS" : "FAILURE",
      filesCreated: allFilesCreated,
      filesModified: allFilesModified,
      durationMs,
    });

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

        const isUpdate = !!(data as Record<string, unknown>).isUpdate;
        const writeLabel = isUpdate ? pc.yellow("Would update:") : pc.green("Would write:");

        outputLines.push(
          pc.bold(
            `[${r.taskId}] ${task?.tool ?? "unknown"}${isUpdate ? pc.yellow(" (update)") : ""}`,
          ),
        );

        if (data.hcl) {
          outputLines.push(`  ${writeLabel} ${pc.underline(`${basePath}/main.tf`)}`);
          outputLines.push(formatOutput(data.hcl as string));
        }
        if (data.yaml) {
          const fileName = getOutputFileName(task?.tool ?? "");
          outputLines.push(`  ${writeLabel} ${pc.underline(`${basePath}/${fileName}`)}`);
          outputLines.push(formatOutput(data.yaml as string));
        }
        if (data.chartYaml) {
          outputLines.push(`  ${writeLabel} ${pc.underline(`${basePath}/Chart.yaml`)}`);
          outputLines.push(formatOutput(data.chartYaml as string));
        }
        if (data.valuesYaml) {
          outputLines.push(`  ${writeLabel} ${pc.underline(`${basePath}/values.yaml`)}`);
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
