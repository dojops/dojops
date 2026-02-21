import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@odaops/api";
import { CLIContext } from "../types";

export async function generateCommand(args: string[], ctx: CLIContext): Promise<void> {
  const prompt = args.filter((a) => !a.startsWith("-")).join(" ");

  if (!prompt) {
    p.log.error("No prompt provided.");
    p.log.info(`  ${pc.dim("$")} oda generate <prompt>`);
    p.log.info(`  ${pc.dim("$")} oda "your prompt here"`);
    process.exit(1);
  }

  const provider = ctx.getProvider();
  const router = createRouter(provider);

  const s = p.spinner();
  s.start("Routing to specialist agent...");
  const route = router.route(prompt);
  s.stop(
    route.confidence > 0
      ? `Routed to ${pc.bold(route.agent.name)} — ${route.reason}`
      : "Using default agent.",
  );

  const s2 = p.spinner();
  s2.start("Thinking...");
  const result = await route.agent.run({ prompt });
  s2.stop("Done.");

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ agent: route.agent.name, content: result.content }));
  } else {
    p.log.message(result.content);
  }
}
