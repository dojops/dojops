import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import {
  loadProfile,
  saveProfile,
  listProfiles,
  getActiveProfile,
  setActiveProfile,
  loadConfig,
} from "../config";

export async function configProfileCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "create": {
      const name = args[1];
      if (!name) {
        p.log.error("Profile name required.");
        p.log.info(`  ${pc.dim("$")} oda config profile create <name>`);
        process.exit(1);
      }
      const config = loadConfig();
      saveProfile(name, config);
      p.log.success(`Profile "${name}" created.`);
      break;
    }
    case "use": {
      const name = args[1];
      if (!name) {
        p.log.error("Profile name required.");
        p.log.info(`  ${pc.dim("$")} oda config profile use <name>`);
        process.exit(1);
      }
      const existing = loadProfile(name);
      if (!existing) {
        p.log.error(`Profile "${name}" not found.`);
        const available = listProfiles();
        if (available.length > 0) {
          p.log.info(`Available profiles: ${available.join(", ")}`);
        }
        process.exit(1);
      }
      setActiveProfile(name);
      p.log.success(`Switched to profile "${name}".`);
      break;
    }
    case "list": {
      const profiles = listProfiles();
      const active = getActiveProfile();
      if (profiles.length === 0) {
        p.log.info("No profiles configured.");
        p.log.info(`  ${pc.dim("$")} oda config profile create <name>`);
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
      break;
    }
    default:
      p.log.error(`Unknown profile subcommand: ${sub ?? "(none)"}`);
      p.log.info(`  ${pc.dim("$")} oda config profile create <name>`);
      p.log.info(`  ${pc.dim("$")} oda config profile use <name>`);
      p.log.info(`  ${pc.dim("$")} oda config profile list`);
      process.exit(1);
  }
}
