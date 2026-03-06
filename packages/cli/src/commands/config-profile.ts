import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { ExitCode, CLIError } from "../exit-codes";
import {
  loadProfile,
  saveProfile,
  deleteProfile,
  listProfiles,
  getActiveProfile,
  setActiveProfile,
  loadConfig,
} from "../config";

export async function configProfileCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "create":
      return profileCreate(args);
    case "use":
      return profileUse(args);
    case "delete":
      return profileDelete(args);
    case "list":
      return profileList(ctx);
    default:
      p.log.info(`  ${pc.dim("$")} dojops config profile create <name>`);
      p.log.info(`  ${pc.dim("$")} dojops config profile use <name>`);
      p.log.info(`  ${pc.dim("$")} dojops config profile list`);
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Unknown profile subcommand: ${sub ?? "(none)"}`,
      );
  }
}

function requireName(args: string[], usage: string): string {
  const name = args[1];
  if (!name) {
    p.log.info(`  ${pc.dim("$")} ${usage}`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Profile name required.");
  }
  return name;
}

function profileCreate(args: string[]): void {
  const name = requireName(args, "dojops config profile create <name>");
  const config = loadConfig();
  saveProfile(name, config);
  p.log.success(`Profile "${name}" created.`);
}

function profileUse(args: string[]): void {
  const name = args[1];
  if (!name) {
    p.log.info(`  ${pc.dim("$")} dojops config profile use <name>`);
    p.log.info(
      `  ${pc.dim("$")} dojops config profile use default  ${pc.dim("(reset to base config)")}`,
    );
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Profile name required.");
  }
  if (name === "default") {
    setActiveProfile(undefined);
    p.log.success("Switched to default configuration.");
    return;
  }
  const existing = loadProfile(name);
  if (!existing) {
    const available = listProfiles();
    if (available.length > 0) {
      p.log.info(`Available profiles: ${available.join(", ")}`);
    }
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Profile "${name}" not found.`);
  }
  setActiveProfile(name);
  p.log.success(`Switched to profile "${name}".`);
}

function profileDelete(args: string[]): void {
  const name = requireName(args, "dojops config profile delete <name>");
  const deleted = deleteProfile(name);
  if (!deleted) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Profile "${name}" not found.`);
  }
  p.log.success(`Profile "${name}" deleted.`);
}

function profileList(ctx: CLIContext): void {
  const profiles = listProfiles();
  const active = getActiveProfile();
  if (profiles.length === 0) {
    p.log.info("No profiles configured.");
    p.log.info(`  ${pc.dim("$")} dojops config profile create <name>`);
    return;
  }
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ profiles, active }));
    return;
  }
  const lines = profiles.map((name) => {
    const marker = name === active ? pc.green(" (active)") : "";
    return `  ${pc.cyan(name)}${marker}`;
  });
  p.note(lines.join("\n"), "Profiles");
}
