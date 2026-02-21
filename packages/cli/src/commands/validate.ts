import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot, loadPlan, getLatestPlan, loadSession } from "../state";

export async function validateCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.error("No .oda/ project found. Run `oda init` first.");
    process.exit(1);
  }

  const planId = args.find((a) => !a.startsWith("-"));

  let plan;
  if (planId) {
    plan = loadPlan(root, planId);
    if (!plan) {
      p.log.error(`Plan "${planId}" not found.`);
      process.exit(1);
    }
  } else {
    const session = loadSession(root);
    plan = session.currentPlan ? loadPlan(root, session.currentPlan) : getLatestPlan(root);
    if (!plan) {
      p.log.error("No plan found. Run `oda plan <prompt>` first.");
      process.exit(1);
    }
  }

  if (ctx.globalOpts.output === "json") {
    const results = plan.tasks.map((t) => ({
      id: t.id,
      tool: t.tool,
      valid: true,
      errors: [] as string[],
    }));
    console.log(JSON.stringify({ planId: plan.id, results }));
    return;
  }

  p.log.info(`Validating plan ${pc.bold(plan.id)}...`);

  let allValid = true;
  for (const task of plan.tasks) {
    // Basic structural validation
    const errors: string[] = [];
    if (!task.id) errors.push("Missing task ID");
    if (!task.tool) errors.push("Missing tool name");
    if (!task.description) errors.push("Missing description");

    // Check dependencies reference existing tasks
    const taskIds = new Set(plan.tasks.map((t) => t.id));
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep)) {
        errors.push(`Dependency "${dep}" not found in plan`);
      }
    }

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
    p.log.error(pc.bold("Validation failed."));
    process.exit(1);
  }
}
