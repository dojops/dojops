import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@dojops/api";
import { sanitizeUserInput } from "@dojops/core";
import { isDevOpsFile } from "@dojops/executor";
import { CLIContext } from "../types";
import { preflightCheck } from "../preflight";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue, hasFlag } from "../parser";
import { findProjectRoot, loadContext } from "../state";

export async function generateCommand(args: string[], ctx: CLIContext): Promise<void> {
  const writePath = extractFlagValue(args, "--write");
  const allowAllPaths = hasFlag(args, "--allow-all-paths");
  const prompt = args.filter((a) => !a.startsWith("-") && a !== writePath).join(" ");

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops generate <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops "your prompt here"`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  const provider = ctx.getProvider();
  const projectRoot = findProjectRoot() ?? undefined;
  const { router } = createRouter(provider, projectRoot);

  // --agent flag: force routing to a specific agent
  const agentName = ctx.globalOpts.agent;
  let route;

  if (agentName) {
    const agents = router.getAgents();
    const match = agents.find((a) => a.name === agentName || a.name.startsWith(agentName));
    if (!match) {
      const available = agents.map((a) => a.name).join(", ");
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Unknown agent: "${agentName}". Available: ${available}`,
      );
    }
    route = { agent: match, confidence: 1, reason: `Forced via --agent ${agentName}` };
    if (ctx.globalOpts.output !== "json") {
      p.log.info(`Using agent: ${pc.bold(match.name)} (forced via --agent)`);
    }
  } else {
    const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
    const s = p.spinner();
    if (!isStructuredOutput) s.start("Routing to specialist agent...");
    route = router.route(prompt);
    if (!isStructuredOutput)
      s.stop(
        route.confidence > 0
          ? `Routed to ${pc.bold(route.agent.name)} — ${route.reason}`
          : "Using default agent.",
      );
    if (ctx.globalOpts.verbose) {
      p.log.info(
        `Agent: ${pc.bold(route.agent.name)} (confidence: ${route.confidence.toFixed(2)}, domain: ${route.agent.domain})`,
      );
    }
  }

  // Pre-flight: check tool dependencies before running LLM
  // Use quiet mode (not json) when outputting JSON to avoid polluting stdout
  const canProceed = preflightCheck(route.agent.name, route.agent.toolDependencies, {
    quiet: ctx.globalOpts.quiet || ctx.globalOpts.output === "json",
  });
  if (!canProceed) {
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }

  // MF-4: Context injection — augment prompt with repo context
  let augmentedPrompt = prompt;
  if (projectRoot) {
    const repoContext = loadContext(projectRoot);
    if (repoContext) {
      const contextParts: string[] = [];
      if (repoContext.primaryLanguage) {
        contextParts.push(`Primary language: ${repoContext.primaryLanguage}`);
      }
      if (repoContext.packageManager) {
        contextParts.push(`Package manager: ${repoContext.packageManager.name}`);
      }
      if (repoContext.ci.length > 0) {
        const platforms = [...new Set(repoContext.ci.map((c) => c.platform))].join(", ");
        contextParts.push(`Existing CI: ${platforms}`);
      }
      if (repoContext.infra.hasTerraform) contextParts.push("Has Terraform");
      if (repoContext.infra.hasKubernetes) contextParts.push("Has Kubernetes");
      if (repoContext.container.hasDockerfile) contextParts.push("Has Dockerfile");
      if (repoContext.meta.isMonorepo) contextParts.push("Monorepo structure");

      if (contextParts.length > 0) {
        augmentedPrompt = `${prompt}\n\n[Project context: ${contextParts.join("; ")}]`;
      }
    }
  }

  const isStructured = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  const s2 = p.spinner();
  if (!isStructured) s2.start("Thinking...");
  const genStart = Date.now();
  const result = await route.agent.run({ prompt: sanitizeUserInput(augmentedPrompt) });
  const genDuration = Date.now() - genStart;
  if (!isStructured) s2.stop("Done.");

  if (ctx.globalOpts.verbose) {
    p.log.info(`Generation completed in ${genDuration}ms (${result.content.length} chars)`);
  }

  // MF-8: --write flag — write output to file
  if (writePath) {
    // H-11: Enforce DevOps allowlist on --write target
    if (!allowAllPaths && !isDevOpsFile(writePath)) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Write to "${writePath}" blocked: not a recognized DevOps file. Use --allow-all-paths to bypass.`,
      );
    }

    // Create .bak backup if file already exists
    if (fs.existsSync(writePath)) {
      fs.copyFileSync(writePath, writePath + ".bak");
      if (ctx.globalOpts.verbose) {
        p.log.info(`Backup created: ${writePath}.bak`);
      }
    }
    fs.writeFileSync(writePath, result.content, "utf-8");
    if (ctx.globalOpts.output === "json") {
      console.log(
        JSON.stringify({ agent: route.agent.name, content: result.content, written: writePath }),
      );
    } else {
      p.log.success(`Written to ${pc.underline(writePath)}`);
    }
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ agent: route.agent.name, content: result.content }));
  } else if (ctx.globalOpts.output === "yaml") {
    // Output as YAML document
    console.log("---");
    console.log(`agent: ${route.agent.name}`);
    console.log("content: |");
    for (const line of result.content.split("\n")) {
      console.log(`  ${line}`);
    }
  } else {
    if (process.stdout.isTTY) {
      p.log.message(result.content);
    } else {
      process.stdout.write(result.content);
    }
  }
}
