import pc from "picocolors";
import * as p from "@clack/prompts";
import { decompose, PlannerExecutor } from "@dojops/planner";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { hasFlag, stripFlags } from "../parser";
import { statusIcon, statusText, formatOutput, getOutputFileName } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";
import { cliApprovalHandler } from "../approval";
import { classifyPlanRisk } from "../risk-classifier";
import * as yaml from "js-yaml";
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
    p.log.info(`  ${pc.dim("$")} dojops plan <prompt>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  const provider = ctx.getProvider();

  // Load repo context for context-aware file placement
  const projectRoot = findProjectRoot();
  const registry = createToolRegistry(provider, projectRoot ?? undefined);
  const tools = registry.getAll();
  const repoContext = projectRoot ? loadContext(projectRoot) : null;

  const isJson = ctx.globalOpts.output === "json";
  const s = p.spinner();
  if (!isJson) s.start("Decomposing goal into tasks...");
  if (ctx.globalOpts.verbose) {
    p.log.info(`Decomposing goal: "${prompt}" using ${tools.length} available tools`);
  }
  let graph;
  try {
    graph = await decompose(prompt, provider, tools, {
      repoContext: repoContext ?? undefined,
    });
  } catch (err) {
    if (!isJson) s.stop("Decomposition failed.");
    throw new CLIError(ExitCode.GENERAL_ERROR, err instanceof Error ? err.message : String(err));
  }
  if (!isJson) s.stop("Tasks decomposed.");

  if (ctx.globalOpts.verbose) {
    p.log.info(`Decomposed into ${graph.tasks.length} task(s)`);
    for (const task of graph.tasks) {
      p.log.info(`  ${pc.blue(task.id)} -> tool: ${pc.bold(task.tool)}`);
    }
  }

  // Enrich tasks with tool metadata
  for (const task of graph.tasks) {
    const meta = registry.getToolMetadata(task.tool);
    if (meta) {
      task.toolType = meta.toolType;
      if (meta.toolType === "custom") {
        task.toolVersion = meta.toolVersion;
        task.toolHash = meta.toolHash;
        task.toolSource = meta.toolSource as "global" | "project" | undefined;
        task.systemPromptHash = meta.systemPromptHash;
      }
    }
  }

  // Display task graph
  if (!isJson) {
    const taskLines = graph.tasks.map((task) => {
      const deps = task.dependsOn.length ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
      return `  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`;
    });
    p.note(taskLines.join("\n"), `${graph.goal} ${pc.dim(`(${graph.tasks.length} tasks)`)}`);
  }

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
      toolVersion: t.toolVersion,
      toolHash: t.toolHash,
      toolSource: t.toolSource,
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
          return [t.tool, meta?.toolVersion ?? "built-in"];
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

  if (!isJson) {
    p.log.success(`Plan saved as ${pc.bold(planId)}`);
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
      throw new CLIError(
        ExitCode.LOCK_CONFLICT,
        `Operation locked by PID ${info?.pid} (${info?.operation})`,
      );
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

      // Build tool metadata for audit enrichment
      const taskDef = savedPlan.tasks.find((t) => t.id === taskResult.taskId);
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

    if (!isJson) {
      if (planResult.success) {
        p.log.success(pc.bold("Plan succeeded."));
      } else {
        p.log.error(pc.bold("Plan failed."));
      }
    }

    if (isJson) {
      console.log(JSON.stringify({ planId, graph, success: planResult.success }, null, 2));
    } else if (ctx.globalOpts.output === "yaml") {
      console.log(
        yaml.dump({ planId, graph, success: planResult.success }, { lineWidth: 120, noRefs: true }),
      );
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

    if (!isJson) {
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
    }

    if (isJson) {
      console.log(JSON.stringify({ planId, graph, success: result.success }, null, 2));
    } else if (ctx.globalOpts.output === "yaml") {
      console.log(
        yaml.dump({ planId, graph, success: result.success }, { lineWidth: 120, noRefs: true }),
      );
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
