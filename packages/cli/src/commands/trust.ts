import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { ExitCode, CLIError } from "../exit-codes";
import { trustFolder, untrustFolder, listTrustedFolders } from "../trust";

function getRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Not inside a project. Run `dojops init` first.");
  }
  return root;
}

function handleTrust(ctx: CLIContext): void {
  const root = getRoot();
  trustFolder(root);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ trusted: true, path: root }));
    return;
  }
  p.log.success(`Trusted: ${pc.cyan(root)}`);
}

function handleUntrust(ctx: CLIContext): void {
  const root = getRoot();
  const removed = untrustFolder(root);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ removed, path: root }));
    return;
  }

  if (removed) {
    p.log.success(`Removed trust for: ${pc.cyan(root)}`);
  } else {
    p.log.info("This folder was not trusted.");
  }
}

function handleList(ctx: CLIContext): void {
  const store = listTrustedFolders();
  const entries = Object.entries(store);

  if (entries.length === 0) {
    p.log.info("No trusted folders.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(store, null, 2));
    return;
  }

  for (const [folder, decision] of entries) {
    const time = pc.dim(new Date(decision.trustedAt).toLocaleString());
    const configs: string[] = [];
    if (decision.configs.agents.length > 0) {
      configs.push(`${decision.configs.agents.length} agents`);
    }
    if (decision.configs.mcpServers.length > 0) configs.push("MCP");
    if (decision.configs.skills.length > 0) {
      configs.push(`${decision.configs.skills.length} skills`);
    }
    const configStr = configs.length > 0 ? pc.dim(` (${configs.join(", ")})`) : "";
    p.log.message(`  ${pc.cyan(folder)}  ${time}${configStr}`);
  }
}

export async function trustCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case "list":
      handleList(ctx);
      break;
    case undefined:
      handleTrust(ctx);
      break;
    default:
      handleTrust(ctx);
      break;
  }
}

export async function untrustCommand(_args: string[], ctx: CLIContext): Promise<void> {
  handleUntrust(ctx);
}
