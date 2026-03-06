import pc from "picocolors";
import * as p from "@clack/prompts";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { findProjectRoot, loadPlan, getLatestPlan, loadSession } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

/** Resolve the plan to validate — by explicit ID, current session, or latest. */
function resolvePlan(root: string, args: string[]) {
  const planId = args.find((a) => !a.startsWith("-"));
  if (planId) {
    const plan = loadPlan(root, planId);
    if (!plan) throw new CLIError(ExitCode.VALIDATION_ERROR, `Plan "${planId}" not found.`);
    return plan;
  }
  const session = loadSession(root);
  const plan = session.currentPlan ? loadPlan(root, session.currentPlan) : getLatestPlan(root);
  if (!plan) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No plan found. Run `dojops plan <prompt>` first.",
    );
  }
  return plan;
}

/** Validate a single task structurally and return its errors. */
function validateTask(
  task: { id: string; tool: string; description: string; dependsOn: string[] },
  taskIds: Set<string>,
): string[] {
  const errors: string[] = [];
  if (!task.id) errors.push("Missing task ID");
  if (!task.tool) errors.push("Missing tool name");
  if (!task.description) errors.push("Missing description");
  for (const dep of task.dependsOn) {
    if (!taskIds.has(dep)) errors.push(`Dependency "${dep}" not found in plan`);
  }
  return errors;
}

/** Warn about tools not found in the registry. */
function warnUnknownTools(
  tasks: Array<{ tool: string }>,
  registry: ReturnType<typeof createToolRegistry>,
): void {
  const unknownTools = tasks.filter((t) => t.tool && !registry.has(t.tool)).map((t) => t.tool);
  if (unknownTools.length === 0) return;
  const unique = [...new Set(unknownTools)];
  p.log.warn(
    `Unknown tool(s) not in registry: ${unique.map((t) => pc.bold(t)).join(", ")}. ` +
      `These may be custom or plugin tools not currently loaded.`,
  );
}

export async function validateCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");
  }

  const plan = resolvePlan(root, args);
  const registry = createToolRegistry(ctx.getProvider(), root);
  warnUnknownTools(plan.tasks, registry);

  if (ctx.globalOpts.output === "json") {
    const results = plan.tasks.map((t) => ({
      id: t.id,
      tool: t.tool,
      valid: true,
      errors: [] as string[],
      inRegistry: registry.has(t.tool),
    }));
    console.log(JSON.stringify({ planId: plan.id, results }));
    return;
  }

  p.log.info(`Validating plan ${pc.bold(plan.id)}...`);
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  let allValid = true;

  for (const task of plan.tasks) {
    const errors = validateTask(task, taskIds);
    if (errors.length > 0) {
      allValid = false;
      p.log.error(`${pc.blue(task.id)} ${pc.red("INVALID")}: ${errors.join(", ")}`);
    } else {
      p.log.success(`${pc.blue(task.id)} ${pc.green("valid")} — ${task.tool}`);
    }
  }

  if (allValid) {
    p.log.success(pc.bold("All tasks valid."));
  } else {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Validation failed.");
  }
}
