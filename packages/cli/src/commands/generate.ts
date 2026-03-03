import * as fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@dojops/api";
import { sanitizeUserInput } from "@dojops/core";
import { isDevOpsFile } from "@dojops/executor";
import { createToolRegistry } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { preflightCheck } from "../preflight";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue, hasFlag } from "../parser";
import { findProjectRoot, loadContext } from "../state";
import { TOOL_FILE_MAP, readExistingToolFile } from "../tool-file-map";

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

  // Context7 documentation augmentation (opt-in)
  let docAugmenter:
    | { augmentPrompt(s: string, kw: string[], q: string): Promise<string> }
    | undefined;
  if (process.env.DOJOPS_CONTEXT_ENABLED === "true") {
    try {
      const { createDocAugmenter } = await import("@dojops/context");
      docAugmenter = createDocAugmenter({
        apiKey: process.env.DOJOPS_CONTEXT7_API_KEY,
      });
    } catch {
      // Context package not available — continue without
    }
  }

  // --tool flag: bypass agent routing, use a specific tool directly
  const toolName = ctx.globalOpts.tool;
  if (toolName) {
    const registry = createToolRegistry(provider, projectRoot, { docAugmenter });
    const tool = registry.get(toolName);
    if (!tool) {
      const available = registry
        .getAll()
        .map((t) => t.name)
        .join(", ");
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Tool "${toolName}" not found. Available: ${available}`,
      );
    }

    if (ctx.globalOpts.output !== "json") {
      p.log.info(`Using tool: ${pc.bold(toolName)} (forced via --tool)`);
    }

    const isStructured =
      ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml" || ctx.globalOpts.raw;
    const s = p.spinner();
    if (!isStructured) s.start("Generating...");
    const result = await tool.generate({ prompt });
    if (!isStructured) s.stop("Done.");

    const content = typeof result === "string" ? result : JSON.stringify(result, null, 2);

    if (ctx.globalOpts.raw) {
      process.stdout.write(content);
      if (!content.endsWith("\n")) process.stdout.write("\n");
      return;
    }

    if (writePath) {
      if (!allowAllPaths && !isDevOpsFile(writePath)) {
        throw new CLIError(
          ExitCode.VALIDATION_ERROR,
          `Write to "${writePath}" blocked: not a recognized DevOps file. Use --allow-all-paths to bypass.`,
        );
      }
      if (fs.existsSync(writePath)) {
        fs.copyFileSync(writePath, writePath + ".bak");
      }
      fs.writeFileSync(writePath, content, "utf-8");
      if (ctx.globalOpts.output === "json") {
        console.log(JSON.stringify({ tool: toolName, content, written: writePath }));
      } else {
        p.log.success(`Written to ${pc.underline(writePath)}`);
      }
      return;
    }

    if (ctx.globalOpts.output === "json") {
      console.log(JSON.stringify({ tool: toolName, content }));
    } else if (ctx.globalOpts.output === "yaml") {
      console.log("---");
      console.log(`tool: ${toolName}`);
      console.log("content: |");
      for (const line of content.split("\n")) {
        console.log(`  ${line}`);
      }
    } else {
      if (process.stdout.isTTY) {
        p.log.message(content);
      } else {
        process.stdout.write(content);
      }
    }
    return;
  }

  const { router } = createRouter(provider, projectRoot, docAugmenter);

  // Load project domains for context-biased routing
  const projectDomains: string[] = projectRoot
    ? (loadContext(projectRoot)?.relevantDomains ?? [])
    : [];

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
    route = router.route(prompt, { projectDomains });
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

  // F-8: Context-aware generation — detect existing config files and pass as context
  const lowerPrompt = prompt.toLowerCase();
  const isUpdateRequest =
    lowerPrompt.includes("update") ||
    lowerPrompt.includes("modify") ||
    lowerPrompt.includes("change") ||
    lowerPrompt.includes("fix") ||
    lowerPrompt.includes("improve") ||
    lowerPrompt.includes("add to");

  if (isUpdateRequest) {
    const cwd = process.cwd();
    for (const toolKey of Object.keys(TOOL_FILE_MAP)) {
      if (!lowerPrompt.includes(toolKey) && !lowerPrompt.includes(toolKey.replace("-", " "))) {
        continue;
      }
      const existing = readExistingToolFile(toolKey, cwd);
      if (existing) {
        augmentedPrompt += `\n\n[Existing ${existing.filePath} content for reference — update this rather than creating from scratch]:\n\`\`\`\n${existing.content}\n\`\`\``;
        if (ctx.globalOpts.verbose) {
          p.log.info(
            `Detected existing file: ${pc.cyan(existing.filePath)} (${existing.content.length} bytes)`,
          );
        }
      }
    }
  }

  const isStructured =
    ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml" || ctx.globalOpts.raw;
  const s2 = p.spinner();
  if (!isStructured) s2.start("Thinking...");
  const genStart = Date.now();
  const result = await route.agent.run({ prompt: sanitizeUserInput(augmentedPrompt) });
  const genDuration = Date.now() - genStart;
  if (!isStructured) s2.stop("Done.");

  if (ctx.globalOpts.verbose) {
    p.log.info(`Generation completed in ${genDuration}ms (${result.content.length} chars)`);
  }

  // F-7: --raw flag — output only the LLM response text, no formatting
  if (ctx.globalOpts.raw) {
    process.stdout.write(result.content);
    if (!result.content.endsWith("\n")) process.stdout.write("\n");
    return;
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
