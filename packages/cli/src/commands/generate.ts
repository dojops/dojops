import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@dojops/api";
import { CLIContext } from "../types";
import { preflightCheck } from "../preflight";
import { ExitCode } from "../exit-codes";
import { findProjectRoot } from "../state";

export async function generateCommand(args: string[], ctx: CLIContext): Promise<void> {
  const prompt = args.filter((a) => !a.startsWith("-")).join(" ");

  if (!prompt) {
    p.log.error("No prompt provided.");
    p.log.info(`  ${pc.dim("$")} dojops generate <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops "your prompt here"`);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const provider = ctx.getProvider();
  const { router } = createRouter(provider, findProjectRoot() ?? undefined);

  const s = p.spinner();
  s.start("Routing to specialist agent...");
  const route = router.route(prompt);
  s.stop(
    route.confidence > 0
      ? `Routed to ${pc.bold(route.agent.name)} — ${route.reason}`
      : "Using default agent.",
  );

  // Pre-flight: check tool dependencies before running LLM
  const canProceed = preflightCheck(route.agent.name, route.agent.toolDependencies, {
    quiet: ctx.globalOpts.quiet,
    json: ctx.globalOpts.output === "json",
  });
  if (!canProceed) {
    process.exit(ExitCode.VALIDATION_ERROR);
  }

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
