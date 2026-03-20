import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot, initProject } from "../state";
import {
  openMemoryDb,
  listErrorPatterns,
  resolveError,
  removeErrorPattern,
  TaskRecord,
} from "../memory";
import { extractFlagValue } from "../parser";

function getRoot(ctx: CLIContext): string {
  const root = findProjectRoot() ?? ctx.cwd;
  if (!findProjectRoot()) initProject(root);
  return root;
}

interface UsagePattern {
  task_type: string;
  count: number;
  success_count: number;
  avg_duration_ms: number;
  last_used: string;
  top_agents: string;
}

function handlePatterns(args: string[], rootDir: string, ctx: CLIContext): void {
  const db = openMemoryDb(rootDir);
  if (!db) {
    p.log.info("No execution history yet. Run some DojOps commands first.");
    return;
  }

  const limit = Number(extractFlagValue(args, "--limit") ?? "20");

  // Aggregate task patterns from history
  const patterns = db
    .prepare(
      `SELECT
        task_type,
        COUNT(*) as count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
        CAST(AVG(duration_ms) AS INTEGER) as avg_duration_ms,
        MAX(timestamp) as last_used
       FROM tasks_history
       GROUP BY task_type
       ORDER BY count DESC
       LIMIT ?`,
    )
    .all(limit) as UsagePattern[];

  if (patterns.length === 0) {
    p.log.info("No execution patterns yet. Run some DojOps commands first.");
    return;
  }

  // Get top agents/skills per task type
  for (const pat of patterns) {
    const agents = db
      .prepare(
        `SELECT agent_or_skill, COUNT(*) as cnt
         FROM tasks_history
         WHERE task_type = ? AND agent_or_skill != ''
         GROUP BY agent_or_skill
         ORDER BY cnt DESC
         LIMIT 3`,
      )
      .all(pat.task_type) as { agent_or_skill: string; cnt: number }[];
    pat.top_agents = agents.map((a) => a.agent_or_skill).join(", ");
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }

  const lines = patterns.map((pat) => {
    const rate = pat.count > 0 ? Math.round((pat.success_count / pat.count) * 100) : 0;
    const rateColor = rate >= 80 ? pc.green : rate >= 50 ? pc.yellow : pc.red;
    const agents = pat.top_agents ? pc.dim(` → ${pat.top_agents}`) : "";
    const duration =
      pat.avg_duration_ms > 0 ? pc.dim(` ~${Math.round(pat.avg_duration_ms / 1000)}s`) : "";
    return `  ${pc.cyan(pat.task_type.padEnd(12))} ${String(pat.count).padStart(4)} runs  ${rateColor(`${rate}% ok`)}${duration}${agents}`;
  });

  p.note(lines.join("\n"), "Execution patterns");
}

function handleRules(args: string[], rootDir: string, ctx: CLIContext): void {
  const taskType = extractFlagValue(args, "--type") ?? undefined;
  const limit = Number(extractFlagValue(args, "--limit") ?? "20");
  const patterns = listErrorPatterns(rootDir, taskType, limit);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }

  if (patterns.length === 0) {
    p.log.info("No error patterns learned yet.");
    return;
  }

  const lines = patterns.map((ep) => {
    const count = ep.occurrences > 1 ? pc.yellow(` (${ep.occurrences}x)`) : "";
    const resolved = ep.resolution ? pc.green(` ✓ ${ep.resolution}`) : pc.dim(" unresolved");
    const msg =
      ep.error_message.length > 80 ? ep.error_message.slice(0, 77) + "..." : ep.error_message;
    return `  ${pc.cyan(`#${ep.id}`)} ${pc.dim(ep.task_type)}${count}  ${msg}${resolved}`;
  });

  p.note(lines.join("\n"), `Learned rules (${patterns.length})`);
}

function handleResolve(args: string[]): void {
  const rootDir = getRoot({ cwd: process.cwd() } as CLIContext);
  const idStr = args[0];
  const resolution = args.slice(1).join(" ").trim();
  if (!idStr || !resolution) {
    throw new Error("Usage: dojops learn resolve <id> <resolution text>");
  }

  const id = Number(idStr.replace(/^#/, ""));
  if (Number.isNaN(id) || id <= 0) {
    throw new Error(`Invalid pattern ID: "${idStr}"`);
  }

  const ok = resolveError(rootDir, id, resolution);
  if (ok) {
    p.log.success(`Marked pattern #${id} as resolved.`);
  } else {
    p.log.info(`Pattern #${id} not found.`);
  }
}

function handleDismiss(args: string[]): void {
  const rootDir = getRoot({ cwd: process.cwd() } as CLIContext);
  const idStr = args[0];
  if (!idStr) {
    throw new Error("Usage: dojops learn dismiss <id>");
  }

  const id = Number(idStr.replace(/^#/, ""));
  if (Number.isNaN(id) || id <= 0) {
    throw new Error(`Invalid pattern ID: "${idStr}"`);
  }

  const ok = removeErrorPattern(rootDir, id);
  if (ok) {
    p.log.success(`Dismissed pattern #${id}.`);
  } else {
    p.log.info(`Pattern #${id} not found.`);
  }
}

function handleSummary(rootDir: string, ctx: CLIContext): void {
  const db = openMemoryDb(rootDir);
  if (!db) {
    p.log.info("No execution history yet.");
    return;
  }

  const totalTasks = (
    db.prepare(`SELECT COUNT(*) as count FROM tasks_history`).get() as { count: number }
  ).count;
  const totalErrors = (
    db.prepare(`SELECT COUNT(*) as count FROM error_patterns`).get() as { count: number }
  ).count;
  const unresolvedErrors = (
    db.prepare(`SELECT COUNT(*) as count FROM error_patterns WHERE resolution = ''`).get() as {
      count: number;
    }
  ).count;
  const recentTasks = db
    .prepare(`SELECT * FROM tasks_history ORDER BY timestamp DESC LIMIT 5`)
    .all() as TaskRecord[];

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ totalTasks, totalErrors, unresolvedErrors, recentTasks }));
    return;
  }

  const lines = [
    `${pc.bold("Total executions:")}  ${totalTasks}`,
    `${pc.bold("Error patterns:")}    ${totalErrors} (${unresolvedErrors} unresolved)`,
  ];

  if (recentTasks.length > 0) {
    lines.push("", pc.bold("Recent:"));
    for (const t of recentTasks) {
      const status =
        t.status === "success" ? pc.green("✓") : t.status === "failure" ? pc.red("✗") : pc.dim("○");
      const prompt = t.prompt.length > 60 ? t.prompt.slice(0, 57) + "..." : t.prompt || t.task_type;
      lines.push(
        `  ${status} ${pc.dim(t.timestamp.slice(0, 10))} ${pc.cyan(t.task_type)} ${prompt}`,
      );
    }
  }

  p.note(lines.join("\n"), "Learning summary");
}

export async function learnCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = getRoot(ctx);
  const sub = args[0] ?? "summary";
  const rest = args.slice(1);

  switch (sub) {
    case "patterns":
      handlePatterns(rest, root, ctx);
      break;
    case "rules":
      handleRules(rest, root, ctx);
      break;
    case "resolve":
      handleResolve(rest);
      break;
    case "dismiss":
      handleDismiss(rest);
      break;
    case "summary":
      handleSummary(root, ctx);
      break;
    default:
      throw new Error(
        `Unknown learn subcommand: "${sub}". Available: summary, patterns, rules, resolve, dismiss`,
      );
  }
}
