import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@odaops/api";
import { CLIContext } from "../types";
import { maskToken } from "../formatter";
import { getConfigPath } from "../config";
import { findProjectRoot, loadSession } from "../state";

export async function inspectCommand(args: string[], ctx: CLIContext): Promise<void> {
  // The subcommand was already parsed into the command path.
  // args[0] may be the subcommand if passed as remaining.
  const sub = args[0];

  switch (sub) {
    case "config":
      return inspectConfig(ctx);
    case "policy":
      return inspectPolicy(ctx);
    case "agents":
      return inspectAgents(ctx);
    case "session":
      return inspectSession(ctx);
    default:
      p.log.error(`Unknown inspect target: ${sub ?? "(none)"}`);
      p.log.info("Available: config, policy, agents, session");
      process.exit(1);
  }
}

function inspectConfig(ctx: CLIContext): void {
  const config = ctx.config;
  if (ctx.globalOpts.output === "json") {
    const safeConfig = {
      ...config,
      tokens: Object.fromEntries(
        Object.entries(config.tokens ?? {}).map(([k, v]) => [k, v ? "***" : null]),
      ),
    };
    console.log(JSON.stringify(safeConfig, null, 2));
    return;
  }

  const lines = [
    `${pc.bold("Provider:")}  ${config.defaultProvider ?? pc.dim("(not set)")}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:    ${maskToken(config.tokens?.openai)}`,
    `  anthropic: ${maskToken(config.tokens?.anthropic)}`,
    `  ollama:    ${pc.dim("(no token needed)")}`,
    `${pc.bold("Config:")}    ${pc.dim(getConfigPath())}`,
  ];
  p.note(lines.join("\n"), "Resolved Configuration");
}

function inspectPolicy(ctx: CLIContext): void {
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ policies: [] }));
    return;
  }
  p.log.info("No policies configured.");
  p.log.info(pc.dim("Policy support coming in a future release."));
}

function inspectAgents(ctx: CLIContext): void {
  const provider = ctx.getProvider();
  const router = createRouter(provider);
  const agents = router.getAgents();

  if (ctx.globalOpts.output === "json") {
    console.log(
      JSON.stringify(
        agents.map((a) => ({
          name: a.name,
          domain: a.domain,
          description: a.description ?? null,
        })),
        null,
        2,
      ),
    );
    return;
  }

  const lines = agents.map((a) => `  ${pc.cyan(a.name.padEnd(28))} ${pc.dim(a.domain)}`);
  p.note(lines.join("\n"), `Specialist Agents (${agents.length})`);
}

function inspectSession(ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .oda/ project found. Run `oda init` first.");
    return;
  }

  const session = loadSession(root);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  const lines = [
    `${pc.bold("Mode:")}        ${session.mode}`,
    `${pc.bold("Current Plan:")} ${session.currentPlan ?? pc.dim("(none)")}`,
    `${pc.bold("Last Agent:")}  ${session.lastAgent ?? pc.dim("(none)")}`,
    `${pc.bold("Risk Level:")}  ${session.riskLevel ?? pc.dim("(none)")}`,
    `${pc.bold("Updated:")}     ${session.updatedAt}`,
  ];
  p.note(lines.join("\n"), "Session State");
}
