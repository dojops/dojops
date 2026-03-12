import fs from "node:fs";
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
  createdAt: string;
}

interface CronConfig {
  jobs: CronEntry[];
}

function cronConfigPath(root: string): string {
  return path.join(root, ".dojops", "cron.json");
}

function loadCronConfig(root: string): CronConfig {
  const p = cronConfigPath(root);
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CronConfig;
  } catch {
    return { jobs: [] };
  }
}

function saveCronConfig(root: string, config: CronConfig): void {
  const configPath = cronConfigPath(root);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function requireRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");
  }
  return root;
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
    createdAt: new Date().toISOString(),
  });
  saveCronConfig(root, config);
  p.log.success(`Cron job added: ${pc.bold(id)}`);
  p.log.info(pc.dim(`  Schedule: ${schedule}`));
  p.log.info(pc.dim(`  Command:  dojops ${command}`));
  p.log.info("");
  p.log.info(pc.dim("Note: Add the following to your system crontab (crontab -e):"));
  p.log.info(`  ${schedule} cd ${root} && dojops ${command}`);
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
    console.log(
      `  ${pc.cyan(job.id)}  ${pc.bold(job.schedule)}  dojops ${job.command}` +
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

  config.jobs.splice(idx, 1);
  saveCronConfig(root, config);
  p.log.success(`Removed cron job: ${pc.bold(jobId)}`);
};

function validateCronSchedule(schedule: string): void {
  const parts = schedule.split(/\s+/);
  if (parts.length !== 5) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid cron schedule: "${schedule}". Expected 5 fields (minute hour day month weekday).`,
    );
  }
}

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
    default:
      p.log.info(pc.bold("USAGE"));
      p.log.info(`  ${pc.dim("$")} dojops cron <subcommand>`);
      p.log.info("");
      p.log.info(pc.bold("SUBCOMMANDS"));
      p.log.info(`  ${pc.cyan("add")}      Add a scheduled job`);
      p.log.info(`  ${pc.cyan("list")}     List scheduled jobs`);
      p.log.info(`  ${pc.cyan("remove")}   Remove a scheduled job`);
      if (!sub) return;
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Unknown subcommand: "${sub}"`);
  }
};
