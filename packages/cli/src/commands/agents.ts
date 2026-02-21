import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@odaops/api";
import { CLIContext } from "../types";

export async function agentsCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "info":
      return agentInfo(args.slice(1), ctx);
    case "list":
    default:
      return agentList(ctx);
  }
}

function agentList(ctx: CLIContext): void {
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

function agentInfo(args: string[], ctx: CLIContext): void {
  const name = args[0];
  if (!name) {
    p.log.error("Agent name required.");
    p.log.info(`  ${pc.dim("$")} oda agents info <name>`);
    process.exit(1);
  }

  const provider = ctx.getProvider();
  const router = createRouter(provider);
  const agent = router.getAgents().find((a) => a.name.toLowerCase() === name.toLowerCase());

  if (!agent) {
    p.log.error(`Agent "${name}" not found.`);
    const names = router
      .getAgents()
      .map((a) => a.name)
      .join(", ");
    p.log.info(`Available agents: ${names}`);
    process.exit(1);
  }

  if (ctx.globalOpts.output === "json") {
    console.log(
      JSON.stringify(
        {
          name: agent.name,
          domain: agent.domain,
          description: agent.description ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  const lines = [
    `${pc.bold("Name:")}        ${agent.name}`,
    `${pc.bold("Domain:")}      ${agent.domain}`,
    `${pc.bold("Description:")} ${agent.description ?? pc.dim("(none)")}`,
  ];
  p.note(lines.join("\n"), `Agent: ${agent.name}`);
}
