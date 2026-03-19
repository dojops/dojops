import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import {
  findProjectRoot,
  loadPlan,
  listExecutions,
  appendAudit,
  acquireLock,
  releaseLock,
  isLocked,
  getCurrentUser,
} from "../state";
import { ExitCode, CLIError } from "../exit-codes";

function deleteProjectFiles(files: string[], root: string): number {
  let deleted = 0;
  for (const file of files) {
    try {
      const absFile = path.resolve(file);
      if (!absFile.startsWith(root + path.sep)) {
        p.log.warn(`Skipping out-of-project file: ${file}`);
        continue;
      }
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        p.log.success(`Deleted: ${file}`);
        deleted++;
      } else {
        p.log.warn(`Not found: ${file}`);
      }
    } catch (err) {
      p.log.error(`Failed to delete ${file}: ${(err as Error).message}`);
    }
  }
  return deleted;
}

/** Show available plans when no planId is provided. */
async function showAvailablePlans(root: string): Promise<void> {
  const { listPlans } = await import("../state");
  const plans = listPlans(root);
  if (plans.length === 0) return;

  p.log.info("");
  p.log.info(pc.bold("Available plans:"));
  for (const plan of plans.slice(0, 10)) {
    const status = plan.approvalStatus ?? "PENDING";
    const date = new Date(plan.createdAt).toLocaleDateString();
    const statusInfo = `(${status}, ${date})`;
    p.log.info(`  ${pc.cyan(plan.id)} ${pc.dim(statusInfo)} ${plan.goal}`);
  }
  if (plans.length > 10) p.log.info(pc.dim(`  ...and ${plans.length - 10} more`));
}

/** Collect all files associated with a plan (plan files + execution files). */
function collectPlanFiles(root: string, planId: string): string[] {
  const plan = loadPlan(root, planId);
  if (!plan) throw new CLIError(ExitCode.VALIDATION_ERROR, `Plan "${planId}" not found.`);

  const execFiles = listExecutions(root)
    .filter((e) => e.planId === planId)
    .flatMap((e) => e.filesCreated);
  return [...new Set([...plan.files, ...execFiles])];
}

/** Execute the clean operation under a lock: delete files, audit, report. */
async function executeClean(
  root: string,
  planId: string,
  allFiles: string[],
  outputFormat: string | undefined,
): Promise<void> {
  if (!acquireLock(root, "clean")) {
    const { info } = isLocked(root);
    throw new CLIError(
      ExitCode.LOCK_CONFLICT,
      `Operation locked by PID ${info?.pid} (${info?.operation})`,
    );
  }

  const startTime = Date.now();
  try {
    const deleted = deleteProjectFiles(allFiles, root);
    await appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      command: `clean ${planId}`,
      action: "clean",
      planId,
      status: "success",
      durationMs: Date.now() - startTime,
    });
    if (outputFormat === "json") {
      console.log(
        JSON.stringify(
          {
            planId,
            status: "success",
            filesDeleted: deleted,
            total: allFiles.length,
            durationMs: Date.now() - startTime,
          },
          null,
          2,
        ),
      );
    } else {
      p.log.success(`Cleaned ${deleted}/${allFiles.length} artifacts.`);
    }
  } finally {
    releaseLock(root);
  }
}

export async function cleanCommand(
  args: string[],
  ctx: CLIContext,
  isLegacyDestroy = false,
): Promise<void> {
  if (isLegacyDestroy) p.log.warn(pc.yellow("'destroy' is deprecated. Use 'clean' instead."));

  const root = findProjectRoot();
  if (!root)
    throw new CLIError(ExitCode.NO_PROJECT, "No .dojops/ project found. Run `dojops init` first.");

  const dryRun = hasFlag(args, "--dry-run");
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const planId = args.find((a) => !a.startsWith("-"));

  if (!planId) {
    p.log.info(`  ${pc.dim("$")} dojops clean <plan-id>`);
    await showAvailablePlans(root);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Plan ID required for clean (safety measure).");
  }

  const allFiles = collectPlanFiles(root, planId);

  if (allFiles.length === 0) {
    if (ctx.globalOpts.output === "json") {
      console.log(JSON.stringify({ planId, status: "noop", filesDeleted: 0 }));
    } else {
      p.log.info("No files to clean for this plan.");
    }
    return;
  }

  if (ctx.globalOpts.output === "json" && dryRun) {
    console.log(JSON.stringify({ planId, dryRun: true, files: allFiles }, null, 2));
    return;
  }

  p.note(
    allFiles.map((f) => `  ${pc.red("-")} ${f}`).join("\n"),
    pc.red(`Clean artifacts from ${planId}`),
  );

  if (dryRun) {
    p.log.info(`${allFiles.length} file(s) would be deleted.`);
    p.log.info(pc.dim("Dry run — no changes will be made."));
    return;
  }

  if (!autoApprove) {
    const confirm = await p.confirm({
      message: `Delete ${allFiles.length} file(s)? This cannot be undone.`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  await executeClean(root, planId, allFiles, ctx.globalOpts.output);
}
