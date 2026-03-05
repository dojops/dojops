import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import fs from "node:fs";
import {
  findProjectRoot,
  listPlans,
  loadPlan,
  listExecutions,
  verifyAuditIntegrity,
  readAudit,
  auditFile,
  loadAuditKey,
  computeAuditHash,
} from "../state";
import type { AuditEntry } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

export async function historyCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "show":
      return historyShow(args.slice(1), ctx);
    case "verify":
      return historyVerify(ctx);
    case "repair":
      return historyRepair(ctx);
    case "audit":
      return historyAudit(args.slice(1), ctx);
    case "list":
    default:
      return historyList(args.slice(sub === "list" ? 1 : 0), ctx);
  }
}

function historyList(args: string[], ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
    return;
  }

  // Parse filter flags
  const statusFilter = extractFlagValue(args, "--status");
  const sinceFilter = extractFlagValue(args, "--since");
  const limitFilter = extractFlagValue(args, "--limit");

  let plans = listPlans(root);
  if (plans.length === 0) {
    p.log.info("No plans found.");
    return;
  }

  // Apply --status filter (PENDING, APPLIED, DENIED, PARTIAL)
  if (statusFilter) {
    const upper = statusFilter.toUpperCase();
    plans = plans.filter((plan) => plan.approvalStatus === upper);
  }

  // Apply --since filter (ISO date string)
  if (sinceFilter) {
    const sinceDate = new Date(sinceFilter);
    if (!Number.isNaN(sinceDate.getTime())) {
      plans = plans.filter((plan) => new Date(plan.createdAt).getTime() >= sinceDate.getTime());
    }
  }

  // Apply --limit filter (after other filters)
  if (limitFilter) {
    const limit = Number.parseInt(limitFilter, 10);
    if (!Number.isNaN(limit) && limit > 0) {
      plans = plans.slice(0, limit);
    }
  }

  if (plans.length === 0) {
    p.log.info("No plans match the given filters.");
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

  if (ctx.globalOpts.output === "yaml") {
    console.log("---");
    for (const plan of plans) {
      console.log(`- id: ${plan.id}`);
      console.log(`  goal: "${plan.goal.replaceAll('"', String.raw`\"`)}"`);
      console.log(`  status: ${plan.approvalStatus}`);
      console.log(`  createdAt: ${plan.createdAt}`);
      console.log(`  tasks: ${plan.tasks.length}`);
    }
    return;
  }

  const lines = plans.map((plan) => {
    let status: string;
    if (plan.approvalStatus === "APPLIED") status = pc.green(plan.approvalStatus);
    else if (plan.approvalStatus === "DENIED") status = pc.red(plan.approvalStatus);
    else if (plan.approvalStatus === "PARTIAL") status = pc.magenta(plan.approvalStatus);
    else status = pc.yellow(plan.approvalStatus);
    const date = new Date(plan.createdAt).toLocaleDateString();
    return `  ${pc.cyan(plan.id.padEnd(16))} ${status.padEnd(20)} ${date}  ${pc.dim(plan.goal.slice(0, 50))}`;
  });

  p.note(lines.join("\n"), `Plans (${plans.length})`);
}

function historyShow(args: string[], ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
    return;
  }

  const planId = args[0];
  if (!planId) {
    p.log.info(`  ${pc.dim("$")} dojops history show <plan-id>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Plan ID required.");
  }

  const plan = loadPlan(root, planId);
  if (!plan) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Plan "${planId}" not found.`);
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
      const stFailed = r.status === "failed" ? pc.red(r.status) : pc.yellow(r.status);
      const st = r.status === "completed" ? pc.green(r.status) : stFailed;
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

function historyAudit(args: string[], ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
    return;
  }

  const planIdFilter = extractFlagValue(args, "--planId") ?? extractFlagValue(args, "--plan-id");
  const statusFilter = extractFlagValue(args, "--status");

  const entries = readAudit(root, {
    planId: planIdFilter,
    status: statusFilter,
  });

  if (entries.length === 0) {
    p.log.info("No audit entries found.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  const lines = entries.map((entry: AuditEntry) => {
    const statusColorFail =
      entry.status === "failure" ? pc.red(entry.status) : pc.yellow(entry.status);
    const statusColor = entry.status === "success" ? pc.green(entry.status) : statusColorFail;
    const seq =
      entry.seq == null ? pc.dim("#   ?") : pc.dim(`#${String(entry.seq).padStart(4, " ")}`);
    const ts = new Date(entry.timestamp).toLocaleString();
    const planInfo = entry.planId ? ` ${pc.cyan(entry.planId)}` : "";
    const duration = pc.dim(`(${entry.durationMs}ms)`);
    return `  ${seq}  ${statusColor.padEnd(20)}  ${pc.bold(entry.command)}/${entry.action}${planInfo}  ${ts}  ${duration}`;
  });

  p.note(lines.join("\n"), `Audit Log (${entries.length} entries)`);
}

function historyVerify(ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
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
    throw new CLIError(ExitCode.GENERAL_ERROR, "Audit log integrity check failed.");
  }
}

function historyRepair(ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
    return;
  }

  const result = verifyAuditIntegrity(root);

  if (result.valid) {
    p.log.success("Audit chain is healthy — no repair needed.");
    return;
  }

  const firstBroken = result.errors[0];
  p.log.warn(
    `Found ${result.errors.length} error(s). First break at line ${firstBroken.line} (seq ${firstBroken.seq}).`,
  );

  const file = auditFile(root);
  const hmacKey = loadAuditKey(root);
  const content = fs.readFileSync(file, "utf-8").trimEnd();
  const lines = content.split("\n");

  const entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // Skip corrupt lines
    }
  }

  if (entries.length === 0) {
    p.log.error("No valid entries found — cannot repair.");
    return;
  }

  // Find the first entry that needs repair (line numbers are 1-based)
  const repairFrom = Math.max(0, firstBroken.line - 1);

  // Recompute hashes from the break point forward
  let previousHash = "genesis";
  let seq = 1;

  // Entries before the break point keep their existing hashes
  if (repairFrom > 0 && entries[repairFrom - 1]) {
    previousHash = entries[repairFrom - 1].hash ?? "genesis";
    seq = (entries[repairFrom - 1].seq ?? 0) + 1;
  }

  let repaired = 0;
  for (let i = repairFrom; i < entries.length; i++) {
    entries[i].seq = seq;
    entries[i].previousHash = previousHash;
    entries[i].hash = computeAuditHash(entries[i], hmacKey);
    previousHash = entries[i].hash!;
    seq++;
    repaired++;
  }

  // Write repaired entries back
  const repairedContent = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(file, repairedContent, "utf-8");

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ repaired, total: entries.length }));
    return;
  }

  p.log.success(
    `Repaired ${repaired} entries (${entries.length} total). Chain integrity restored.`,
  );
}
