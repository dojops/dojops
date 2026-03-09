import pc from "picocolors";
import * as p from "@clack/prompts";
import { decompose, TaskGraph } from "@dojops/planner";
import { createToolRegistry, ToolRegistry } from "@dojops/tool-registry";
import { scanRepo } from "@dojops/core";
import { CLIContext } from "../types";
import { hasFlag, stripFlags, extractFlagValue } from "../parser";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { runHooks } from "../hooks";
import { classifyPlanRisk } from "../risk-classifier";
import { wrapForNote, truncateNoteTitle } from "../formatter";
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

/** Enrich each task with tool metadata from the registry. */
function enrichTasksWithMetadata(graph: TaskGraph, registry: ToolRegistry): void {
  for (const task of graph.tasks) {
    const meta = registry.getToolMetadata(task.tool);
    if (!meta) continue;
    task.toolType = meta.toolType;
    if (meta.toolType === "custom") {
      task.toolVersion = meta.toolVersion;
      task.toolHash = meta.toolHash;
      task.toolSource = meta.toolSource as "global" | "project" | undefined;
      task.systemPromptHash = meta.systemPromptHash;
    }
  }
}

/** Format and display the task graph via p.note(). */
function displayTaskGraph(graph: TaskGraph): void {
  const taskLines = graph.tasks.map((task) => {
    const deps = task.dependsOn.length ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    return `  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`;
  });
  const taskCountLabel = pc.dim(`(${graph.tasks.length} tasks)`);
  p.note(wrapForNote(taskLines.join("\n")), truncateNoteTitle(`${graph.goal} ${taskCountLabel}`));
}

/** Build the PlanState object for persistence. */
function buildPlanState(
  planId: string,
  graph: TaskGraph,
  registry: ToolRegistry,
  ctx: CLIContext,
  providerName: string,
  skipVerify: boolean,
): PlanState {
  return {
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
      provider: providerName,
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
}

/** Output the plan result in the requested format (JSON, YAML, or text). */
function outputPlanResult(
  planId: string,
  graph: TaskGraph,
  outputFormat: string | undefined,
): void {
  if (outputFormat === "json") {
    console.log(JSON.stringify({ planId, graph }, null, 2));
    return;
  }
  if (outputFormat === "yaml") {
    console.log(yaml.dump({ planId, graph }, { lineWidth: 120, noRefs: true }));
    return;
  }
  p.log.info(pc.dim("To execute this plan, run: dojops apply " + planId));
}

/** Parse plan command flags and extract the prompt text. */
function parsePlanArgs(
  args: string[],
  ctx: CLIContext,
): { prompt: string; executeMode: boolean; autoApprove: boolean; skipVerify: boolean } {
  const executeMode = hasFlag(args, "--execute");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const skipVerify = hasFlag(args, "--skip-verify");
  const prompt = stripFlags(
    args,
    new Set(["--execute", "--yes", "--skip-verify", "--force", "--allow-all-paths"]),
    new Set(["--timeout", "--repair-attempts"]),
  ).join(" ");
  return { prompt, executeMode, autoApprove, skipVerify };
}

/** Filter modules to a single module if --module flag is set. */
function applyToolFilter(
  tools: ReturnType<ToolRegistry["getAll"]>,
  toolName: string | undefined,
  isJson: boolean,
): ReturnType<ToolRegistry["getAll"]> {
  if (!toolName) return tools;
  const match = tools.find((t) => t.name === toolName);
  if (!match) {
    const available = tools.map((t) => t.name).join(", ");
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Module "${toolName}" not found. Available: ${available}`,
    );
  }
  if (!isJson) p.log.info(`Using module: ${pc.bold(toolName)}`);
  return [match];
}

/** Run the decomposition and display verbose output if enabled. */
async function runDecomposition(
  prompt: string,
  provider: ReturnType<CLIContext["getProvider"]>,
  tools: ReturnType<ToolRegistry["getAll"]>,
  repoContext: ReturnType<typeof loadContext> | null,
  ctx: CLIContext,
  isJson: boolean,
  executionMemory?: string,
): Promise<TaskGraph> {
  const s = p.spinner();
  if (!isJson) s.start("Decomposing goal into tasks...");
  if (ctx.globalOpts.verbose) {
    p.log.info(`Decomposing goal: "${prompt}" using ${tools.length} available tools`);
  }
  let graph;
  try {
    graph = await decompose(prompt, provider, tools, {
      repoContext: repoContext ?? undefined,
      executionMemory,
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
  return graph;
}

/** Save the plan and update session state. Returns the plan ID. */
function persistPlan(
  graph: TaskGraph,
  registry: ToolRegistry,
  ctx: CLIContext,
  providerName: string,
  skipVerify: boolean,
  isJson: boolean,
): { planId: string; root: string } {
  let root = findProjectRoot();
  if (!root) {
    root = ctx.cwd;
    initProject(root);
  }
  const planId = generatePlanId();
  const savedPlan = buildPlanState(planId, graph, registry, ctx, providerName, skipVerify);
  savePlan(root, savedPlan);

  const session = loadSession(root);
  session.currentPlan = planId;
  session.mode = "PLAN";
  saveSession(root, session);

  if (!isJson) {
    p.log.success(`Plan saved as ${pc.bold(planId)}`);
  }
  return { planId, root };
}

/** Build apply arguments and delegate to the apply command. */
async function delegateToApply(
  planId: string,
  args: string[],
  autoApprove: boolean,
  skipVerify: boolean,
  ctx: CLIContext,
): Promise<void> {
  const { applyCommand } = await import("./apply");
  const applyArgs = [planId];
  if (autoApprove) applyArgs.push("--yes");
  if (skipVerify) applyArgs.push("--skip-verify");
  if (hasFlag(args, "--force")) applyArgs.push("--force");
  if (hasFlag(args, "--allow-all-paths")) applyArgs.push("--allow-all-paths");
  const repairAttempts = extractFlagValue(args, "--repair-attempts");
  if (repairAttempts) applyArgs.push("--repair-attempts", repairAttempts);
  return applyCommand(applyArgs, ctx);
}

function runPrePlanHook(projectRoot: string | null, prompt: string, verbose: boolean): void {
  if (!projectRoot) return;
  const hookOk = runHooks(projectRoot, "pre-plan", { prompt }, { verbose });
  if (!hookOk) throw new CLIError(ExitCode.GENERAL_ERROR, "Pre-plan hook failed.");
}

function loadRepoContext(projectRoot: string | null): ReturnType<typeof loadContext> {
  if (!projectRoot) return null;
  // Fresh repo scan gives the planner real-time knowledge of existing infrastructure
  // (CI, Dockerfiles, Terraform, K8s, etc.) so it plans "update" instead of "create"
  try {
    return scanRepo(projectRoot);
  } catch {
    // Fresh scan failed — fall back to static .dojops/context.json
    return loadContext(projectRoot);
  }
}

async function loadExecutionMemory(
  projectRoot: string | null,
  prompt: string,
): Promise<string | undefined> {
  if (!projectRoot) return undefined;
  try {
    const { queryMemory, buildMemoryContextString } = await import("../memory");
    const memCtx = queryMemory(projectRoot, "plan", prompt);
    return buildMemoryContextString(memCtx) ?? undefined;
  } catch {
    // Memory is non-critical — proceed without it
    return undefined;
  }
}

export async function planCommand(args: string[], ctx: CLIContext): Promise<void> {
  const { prompt, executeMode, autoApprove, skipVerify } = parsePlanArgs(args, ctx);

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops plan <prompt>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  const projectRoot = findProjectRoot();
  runPrePlanHook(projectRoot, prompt, ctx.globalOpts.verbose);

  const provider = ctx.getProvider();
  const registry = createToolRegistry(provider, projectRoot ?? undefined);
  const repoContext = loadRepoContext(projectRoot);
  const isJson = ctx.globalOpts.output === "json";

  const tools = applyToolFilter(registry.getAll(), ctx.globalOpts.tool, isJson);
  const executionMemory = await loadExecutionMemory(projectRoot, prompt);

  const graph = await runDecomposition(
    prompt,
    provider,
    tools,
    repoContext,
    ctx,
    isJson,
    executionMemory,
  );

  enrichTasksWithMetadata(graph, registry);
  if (!isJson) displayTaskGraph(graph);

  if (ctx.globalOpts.dryRun) {
    if (!isJson) {
      p.log.info(`${pc.yellow("[dry-run]")} Plan not saved — preview only.`);
    }
    outputPlanResult("dry-run", graph, ctx.globalOpts.output);
    return;
  }

  const { planId, root } = persistPlan(graph, registry, ctx, provider.name, skipVerify, isJson);
  const startTime = Date.now();

  if (executeMode) {
    return delegateToApply(planId, args, autoApprove, skipVerify, ctx);
  }

  appendAudit(root, {
    timestamp: new Date().toISOString(),
    user: getCurrentUser(),
    command: `plan "${prompt}"`,
    action: "plan",
    planId,
    status: "success",
    durationMs: Date.now() - startTime,
  });

  if (root) {
    runHooks(root, "post-plan", { prompt }, { verbose: ctx.globalOpts.verbose });
  }

  outputPlanResult(planId, graph, ctx.globalOpts.output);
}
