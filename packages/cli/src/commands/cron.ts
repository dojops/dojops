import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CommandHandler } from "../types";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot } from "../state";

interface CronEntry {
  id: string;
  schedule: string;
  command: string;
  description?: string;
  enabled: boolean;
  createdAt: string;
  installedAt?: string;
}

interface CronConfig {
  jobs: CronEntry[];
}

const CRON_MARKER_PREFIX = "# dojops:";

function cronConfigPath(root: string): string {
  return path.join(root, ".dojops", "cron.json");
}

function loadCronConfig(root: string): CronConfig {
  const configFile = cronConfigPath(root);
  try {
    return JSON.parse(fs.readFileSync(configFile, "utf-8")) as CronConfig;
  } catch {
    return { jobs: [] };
  }
}

function saveCronConfig(root: string, config: CronConfig): void {
  const configFile = cronConfigPath(root);
  const dir = path.dirname(configFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
}

function requireRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");
  }
  return root;
}

function readCurrentCrontab(): string {
  try {
    return execFileSync("crontab", ["-l"], { stdio: "pipe" }).toString("utf-8");
  } catch {
    return "";
  }
}

function writeCrontab(content: string): void {
  // Write to a temp file, then install via crontab
  const tmpFile = path.join(os.tmpdir(), `dojops-crontab-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpFile, content);
    execFileSync("crontab", [tmpFile], { stdio: "pipe" });
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup failure
    }
  }
}

function buildCronLine(job: CronEntry, root: string): string {
  return `${job.schedule} cd ${root} && dojops ${job.command} ${CRON_MARKER_PREFIX}${job.id}`;
}

function syncCrontab(root: string, config: CronConfig): { installed: number; removed: number } {
  const currentCrontab = readCurrentCrontab();
  const lines = currentCrontab.split("\n");

  // Remove all existing dojops entries for this project
  const nonDojopsLines = lines.filter((line) => !line.includes(CRON_MARKER_PREFIX));

  // Add enabled jobs
  const enabledJobs = config.jobs.filter((j) => j.enabled);
  const newLines = enabledJobs.map((job) => buildCronLine(job, root));

  const finalContent =
    [...nonDojopsLines.filter((l) => l.trim() !== ""), ...newLines].join("\n") + "\n";
  writeCrontab(finalContent);

  // Count what changed
  const previousCount = lines.filter((l) => l.includes(CRON_MARKER_PREFIX)).length;
  return { installed: newLines.length, removed: Math.max(0, previousCount - newLines.length) };
}

function validateCronSchedule(schedule: string): void {
  const parts = schedule.split(/\s+/);
  if (parts.length !== 5) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid cron schedule: "${schedule}". Expected 5 fields (minute hour day month weekday).`,
    );
  }
}

const cronAddCommand: CommandHandler = async (args) => {
  const schedule = args[0];
  const command = args.slice(1).join(" ");

  if (!schedule || !command) {
    p.log.info(`  ${pc.dim("$")} dojops cron add "<schedule>" <dojops-command>`);
    p.log.info(`  ${pc.dim("$")} dojops cron add "0 2 * * *" plan "backup terraform"`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Schedule and command required.");
  }

  validateCronSchedule(schedule);

  const root = requireRoot();
  const config = loadCronConfig(root);
  const id = `job-${Date.now().toString(36)}`;
  config.jobs.push({
    id,
    schedule,
    command,
    enabled: true,
    createdAt: new Date().toISOString(),
  });
  saveCronConfig(root, config);
  p.log.success(`Cron job added: ${pc.bold(id)}`);
  p.log.info(pc.dim(`  Schedule: ${schedule}`));
  p.log.info(pc.dim(`  Command:  dojops ${command}`));
  p.log.info("");
  p.log.info(`Run ${pc.cyan("dojops cron install")} to activate in system crontab.`);
};

const cronListCommand: CommandHandler = async (_args, ctx) => {
  const root = requireRoot();
  const config = loadCronConfig(root);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(config.jobs, null, 2));
    return;
  }

  if (config.jobs.length === 0) {
    p.log.info("No scheduled jobs. Use `dojops cron add` to create one.");
    return;
  }

  for (const job of config.jobs) {
    const statusIcon = job.enabled ? pc.green("●") : pc.dim("○");
    const installedTag = job.installedAt ? pc.green(" [installed]") : pc.dim(" [not installed]");
    console.log(
      `  ${statusIcon} ${pc.cyan(job.id)}  ${pc.bold(job.schedule)}  dojops ${job.command}${installedTag}` +
        (job.description ? `  ${pc.dim(job.description)}` : ""),
    );
  }
  p.log.info(pc.dim(`\n${config.jobs.length} job(s) configured.`));
};

const cronRemoveCommand: CommandHandler = async (args) => {
  const jobId = args[0];
  if (!jobId) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Job ID required. Use `dojops cron list` to see IDs.",
    );
  }

  const root = requireRoot();
  const config = loadCronConfig(root);
  const idx = config.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Job "${jobId}" not found.`);
  }

  const wasInstalled = config.jobs[idx].installedAt;
  config.jobs.splice(idx, 1);
  saveCronConfig(root, config);

  if (wasInstalled) {
    syncCrontab(root, config);
    p.log.success(`Removed and uninstalled cron job: ${pc.bold(jobId)}`);
  } else {
    p.log.success(`Removed cron job: ${pc.bold(jobId)}`);
  }
};

const cronInstallCommand: CommandHandler = async () => {
  const root = requireRoot();
  const config = loadCronConfig(root);
  const enabledJobs = config.jobs.filter((j) => j.enabled);

  if (enabledJobs.length === 0) {
    p.log.info("No enabled jobs to install. Use `dojops cron add` first.");
    return;
  }

  const { installed } = syncCrontab(root, config);
  const now = new Date().toISOString();
  for (const job of enabledJobs) {
    job.installedAt = now;
  }
  saveCronConfig(root, config);

  p.log.success(`Installed ${installed} job(s) to system crontab.`);
  for (const job of enabledJobs) {
    p.log.info(pc.dim(`  ${job.schedule}  dojops ${job.command}`));
  }
};

const cronUninstallCommand: CommandHandler = async () => {
  const root = requireRoot();
  const currentCrontab = readCurrentCrontab();
  const lines = currentCrontab.split("\n");
  const dojopsLines = lines.filter((l) => l.includes(CRON_MARKER_PREFIX));

  if (dojopsLines.length === 0) {
    p.log.info("No DojOps cron jobs found in system crontab.");
    return;
  }

  const nonDojopsLines = lines.filter((l) => !l.includes(CRON_MARKER_PREFIX));
  writeCrontab(nonDojopsLines.filter((l) => l.trim() !== "").join("\n") + "\n");

  const config = loadCronConfig(root);
  for (const job of config.jobs) {
    job.installedAt = undefined;
  }
  saveCronConfig(root, config);

  p.log.success(`Removed ${dojopsLines.length} DojOps job(s) from system crontab.`);
};

const cronEnableCommand: CommandHandler = async (args) => {
  const jobId = args[0];
  if (!jobId) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Job ID required.");
  }

  const root = requireRoot();
  const config = loadCronConfig(root);
  const job = config.jobs.find((j) => j.id === jobId);
  if (!job) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Job "${jobId}" not found.`);
  }

  job.enabled = true;
  saveCronConfig(root, config);

  if (job.installedAt) {
    syncCrontab(root, config);
    p.log.success(`Enabled and re-installed: ${pc.bold(jobId)}`);
  } else {
    p.log.success(`Enabled: ${pc.bold(jobId)}. Run ${pc.cyan("dojops cron install")} to activate.`);
  }
};

const cronDisableCommand: CommandHandler = async (args) => {
  const jobId = args[0];
  if (!jobId) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Job ID required.");
  }

  const root = requireRoot();
  const config = loadCronConfig(root);
  const job = config.jobs.find((j) => j.id === jobId);
  if (!job) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Job "${jobId}" not found.`);
  }

  job.enabled = false;
  saveCronConfig(root, config);

  if (job.installedAt) {
    syncCrontab(root, config);
    job.installedAt = undefined;
    saveCronConfig(root, config);
    p.log.success(`Disabled and removed from crontab: ${pc.bold(jobId)}`);
  } else {
    p.log.success(`Disabled: ${pc.bold(jobId)}`);
  }
};

const cronStatusCommand: CommandHandler = async (_args, ctx) => {
  const root = requireRoot();
  const config = loadCronConfig(root);
  const currentCrontab = readCurrentCrontab();
  const installedCount = currentCrontab
    .split("\n")
    .filter((l) => l.includes(CRON_MARKER_PREFIX)).length;

  const summary = {
    totalJobs: config.jobs.length,
    enabledJobs: config.jobs.filter((j) => j.enabled).length,
    installedInCrontab: installedCount,
  };

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const syncStatus =
    summary.enabledJobs === installedCount
      ? pc.green("in sync")
      : pc.yellow("out of sync — run `dojops cron install`");

  const lines = [
    `${pc.bold("Total jobs:")}     ${summary.totalJobs}`,
    `${pc.bold("Enabled:")}        ${summary.enabledJobs}`,
    `${pc.bold("In crontab:")}     ${installedCount}`,
    `${pc.bold("Sync status:")}    ${syncStatus}`,
  ];
  p.note(lines.join("\n"), "Cron Status");
};

export const cronCommand: CommandHandler = async (args, ctx) => {
  const sub = args[0];
  const subArgs = args.slice(1);

  switch (sub) {
    case "add":
      return cronAddCommand(subArgs, ctx);
    case "list":
      return cronListCommand(subArgs, ctx);
    case "remove":
      return cronRemoveCommand(subArgs, ctx);
    case "install":
      return cronInstallCommand(subArgs, ctx);
    case "uninstall":
      return cronUninstallCommand(subArgs, ctx);
    case "enable":
      return cronEnableCommand(subArgs, ctx);
    case "disable":
      return cronDisableCommand(subArgs, ctx);
    case "status":
      return cronStatusCommand(subArgs, ctx);
    default:
      p.log.info(pc.bold("USAGE"));
      p.log.info(`  ${pc.dim("$")} dojops cron <subcommand>`);
      p.log.info("");
      p.log.info(pc.bold("SUBCOMMANDS"));
      p.log.info(`  ${pc.cyan("add")}         Add a scheduled job`);
      p.log.info(`  ${pc.cyan("list")}        List scheduled jobs`);
      p.log.info(`  ${pc.cyan("remove")}      Remove a scheduled job`);
      p.log.info(`  ${pc.cyan("install")}     Install all enabled jobs to system crontab`);
      p.log.info(`  ${pc.cyan("uninstall")}   Remove all DojOps jobs from system crontab`);
      p.log.info(`  ${pc.cyan("enable")}      Enable a disabled job`);
      p.log.info(`  ${pc.cyan("disable")}     Disable a job (removes from crontab)`);
      p.log.info(`  ${pc.cyan("status")}      Show crontab sync status`);
      if (!sub) return;
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Unknown subcommand: "${sub}"`);
  }
};
