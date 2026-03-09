import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { hasFlag, stripFlags, extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";

/**
 * Autonomous mode: plan → execute → verify → repair → commit.
 * Zero human prompts for LOW/MEDIUM risk tasks.
 *
 * Internally becomes: --execute --yes (risk-based approval)
 *   with configurable --repair-attempts (default 4).
 *
 * Usage: dojops auto "Create CI for Node app"
 */
export async function autoCommand(args: string[], ctx: CLIContext): Promise<void> {
  const prompt = stripFlags(
    args,
    new Set(["--skip-verify", "--force", "--allow-all-paths", "--commit"]),
    new Set(["--timeout", "--repair-attempts"]),
  ).join(" ");

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops auto <prompt>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  const skipVerify = hasFlag(args, "--skip-verify");
  const repairAttempts = extractFlagValue(args, "--repair-attempts");

  p.log.info(`${pc.bold(pc.cyan("Autonomous mode"))} — risk-based approval, self-repair enabled`);
  if (repairAttempts) {
    p.log.info(pc.dim(`Repair attempts: ${repairAttempts}`));
  }

  // Delegate to plan --execute --yes with autonomous policy
  const { planCommand } = await import("./plan");
  const planArgs = [
    "--execute",
    "--yes", // auto-approve (SafeExecutor uses risk-based mode internally)
    prompt,
  ];
  if (skipVerify) planArgs.push("--skip-verify");
  if (hasFlag(args, "--force")) planArgs.push("--force");
  if (hasFlag(args, "--allow-all-paths")) planArgs.push("--allow-all-paths");
  if (repairAttempts) planArgs.push("--repair-attempts", repairAttempts);

  await planCommand(planArgs, ctx);
}
