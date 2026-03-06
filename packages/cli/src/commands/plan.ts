import pc from "picocolors";
import * as p from "@clack/prompts";
import { decompose } from "@dojops/planner";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { hasFlag, stripFlags } from "../parser";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { classifyPlanRisk } from "../risk-classifier";
import { wrapForNote } from "../formatter";
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
  loadContext,
  getDojopsVersion,
  PlanState,
  getCurrentUser,
} from "../state";

export async function planCommand(args: string[], ctx: CLIContext): Promise<void> {
  const executeMode = hasFlag(args, "--execute");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const skipVerify = hasFlag(args, "--skip-verify");

  const prompt = stripFlags(
    args,
    new Set(["--execute", "--yes", "--skip-verify", "--force", "--allow-all-paths"]),
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
  let tools = registry.getAll();
  const repoContext = projectRoot ? loadContext(projectRoot) : null;
  const isJson = ctx.globalOpts.output === "json";

  // --tool flag: restrict decomposition to a single tool
  if (ctx.globalOpts.tool) {
    const toolName = ctx.globalOpts.tool;
    const match = tools.find((t) => t.name === toolName);
    if (!match) {
      const available = tools.map((t) => t.name).join(", ");
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Module "${toolName}" not found. Available: ${available}`,
      );
    }
    tools = [match];
    if (!isJson) p.log.info(`Using module: ${pc.bold(toolName)}`);
  }
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
    throw new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(err));
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
    const taskCountLabel = pc.dim(`(${graph.tasks.length} tasks)`);
    p.note(wrapForNote(taskLines.join("\n")), `${graph.goal} ${taskCountLabel}`);
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
      temperature: ctx.resolvedTemperature,
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
    // Delegate to apply command which has full safety features
    // (git dirty check, drift warnings, impact summary, SIGINT handling)
    const { applyCommand } = await import("./apply");
    const applyArgs = [planId];
    if (autoApprove) applyArgs.push("--yes");
    if (skipVerify) applyArgs.push("--skip-verify");
    if (hasFlag(args, "--force")) applyArgs.push("--force");
    if (hasFlag(args, "--allow-all-paths")) applyArgs.push("--allow-all-paths");
    return applyCommand(applyArgs, ctx);
  } else {
    // Plan-only mode: show decomposed tasks without executing
    // Task graph is already displayed above via p.note()

    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      command: `plan "${prompt}"`,
      action: "plan",
      planId,
      status: "success",
      durationMs: Date.now() - startTime,
    });

    if (isJson) {
      console.log(JSON.stringify({ planId, graph }, null, 2));
    } else if (ctx.globalOpts.output === "yaml") {
      console.log(yaml.dump({ planId, graph }, { lineWidth: 120, noRefs: true }));
    } else {
      p.log.info(pc.dim("To execute this plan, run: dojops apply " + planId));
    }
  }
}
