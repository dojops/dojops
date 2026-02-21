import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import {
  findProjectRoot,
  listPlans,
  loadPlan,
  listExecutions,
  verifyAuditIntegrity,
} from "../state";

export async function historyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "show":
      return historyShow(args.slice(1), ctx);
    case "verify":
      return historyVerify(ctx);
    case "rollback": {
      const { rollbackCommand } = await import("./rollback");
      return rollbackCommand(args.slice(1), ctx);
    }
    case "list":
    default:
      return historyList(ctx);
  }
}

function historyList(ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .oda/ project found. Run `oda init` first.");
    return;
  }

  const plans = listPlans(root);
  if (plans.length === 0) {
    p.log.info("No plans found.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(
      JSON.stringify(
        plans.map((plan) => ({
          id: plan.id,
          goal: plan.goal,
          status: plan.approvalStatus,
          createdAt: plan.createdAt,
          tasks: plan.tasks.length,
        })),
        null,
        2,
      ),
    );
    return;
  }

  const lines = plans.map((plan) => {
    const status =
      plan.approvalStatus === "APPLIED"
        ? pc.green(plan.approvalStatus)
        : plan.approvalStatus === "DENIED"
          ? pc.red(plan.approvalStatus)
          : plan.approvalStatus === "PARTIAL"
            ? pc.magenta(plan.approvalStatus)
            : pc.yellow(plan.approvalStatus);
    const date = new Date(plan.createdAt).toLocaleDateString();
    return `  ${pc.cyan(plan.id.padEnd(16))} ${status.padEnd(20)} ${date}  ${pc.dim(plan.goal.slice(0, 50))}`;
  });

  p.note(lines.join("\n"), `Plans (${plans.length})`);
}

function historyShow(args: string[], ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .oda/ project found. Run `oda init` first.");
    return;
  }

  const planId = args[0];
  if (!planId) {
    p.log.error("Plan ID required.");
    p.log.info(`  ${pc.dim("$")} oda history show <plan-id>`);
    process.exit(1);
  }

  const plan = loadPlan(root, planId);
  if (!plan) {
    p.log.error(`Plan "${planId}" not found.`);
    process.exit(1);
  }

  if (ctx.globalOpts.output === "json") {
    const executions = listExecutions(root).filter((e) => e.planId === planId);
    console.log(JSON.stringify({ plan, executions }, null, 2));
    return;
  }

  const taskLines = plan.tasks.map((t) => {
    const deps = t.dependsOn.length > 0 ? pc.dim(` (after: ${t.dependsOn.join(", ")})`) : "";
    return `  ${pc.blue(t.id)} ${pc.bold(t.tool)}: ${t.description}${deps}`;
  });

  const infoLines = [
    `${pc.bold("ID:")}       ${plan.id}`,
    `${pc.bold("Goal:")}     ${plan.goal}`,
    `${pc.bold("Status:")}   ${plan.approvalStatus}`,
    `${pc.bold("Risk:")}     ${plan.risk || "unknown"}`,
    `${pc.bold("Created:")}  ${plan.createdAt}`,
    "",
    pc.bold("Tasks:"),
    ...taskLines,
  ];

  if (plan.files.length > 0) {
    infoLines.push("", pc.bold("Files:"));
    for (const f of plan.files) {
      infoLines.push(`  ${pc.dim("-")} ${f}`);
    }
  }

  if (plan.results && plan.results.length > 0) {
    infoLines.push("", pc.bold("Results:"));
    for (const r of plan.results) {
      const st =
        r.status === "completed"
          ? pc.green(r.status)
          : r.status === "failed"
            ? pc.red(r.status)
            : pc.yellow(r.status);
      let line = `  ${pc.blue(r.taskId)} ${st}`;
      if (r.executionStatus) line += ` exec:${r.executionStatus}`;
      if (r.error) line += ` ${pc.red(r.error)}`;
      infoLines.push(line);
    }
  }

  p.note(infoLines.join("\n"), `Plan: ${plan.id}`);

  // Show execution records
  const executions = listExecutions(root).filter((e) => e.planId === planId);
  if (executions.length > 0) {
    const execLines = executions.map((e) => {
      const status = e.status === "SUCCESS" ? pc.green(e.status) : pc.red(e.status);
      return `  ${status}  ${e.executedAt}  ${pc.dim(`(${e.durationMs}ms)`)}`;
    });
    p.note(execLines.join("\n"), "Execution History");
  }
}

function historyVerify(ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .oda/ project found. Run `oda init` first.");
    return;
  }

  const result = verifyAuditIntegrity(root);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.valid) {
    p.log.success(`Audit log integrity verified: ${result.totalEntries} entries, chain intact.`);
  } else {
    p.log.error(
      `Audit log integrity check failed: ${result.errors.length} error(s) in ${result.totalEntries} entries.`,
    );
    for (const err of result.errors) {
      p.log.error(`  Line ${err.line} (seq ${err.seq}): ${err.reason}`);
    }
  }
}
