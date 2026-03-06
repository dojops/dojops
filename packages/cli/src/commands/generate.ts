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

type DocAugmenter = { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };
type Context7Provider = {
  resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
  queryDocs(libraryId: string, query: string): Promise<string>;
};

function isStructuredOutput(ctx: CLIContext): boolean {
  return ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml" || ctx.globalOpts.raw;
}

async function initContext7(): Promise<{
  docAugmenter?: DocAugmenter;
  context7Provider?: Context7Provider;
}> {
  if (process.env.DOJOPS_CONTEXT_ENABLED !== "true") {
    return {};
  }
  try {
    const { createDocAugmenter, Context7Client } = await import("@dojops/context");
    return {
      docAugmenter: createDocAugmenter({ apiKey: process.env.DOJOPS_CONTEXT7_API_KEY }),
      context7Provider: new Context7Client({ apiKey: process.env.DOJOPS_CONTEXT7_API_KEY }),
    };
  } catch {
    return {};
  }
}

function buildProjectContextString(projectRoot: string | undefined): string | undefined {
  if (!projectRoot) return undefined;
  const repoCtx = loadContext(projectRoot);
  if (!repoCtx) return undefined;

  const parts: string[] = [];
  if (repoCtx.primaryLanguage) parts.push(`Language: ${repoCtx.primaryLanguage}`);
  if (repoCtx.packageManager) parts.push(`Package manager: ${repoCtx.packageManager.name}`);
  if (repoCtx.ci.length > 0) {
    parts.push(
      `CI: ${[...new Set(repoCtx.ci.map((c: { platform: string }) => c.platform))].join(", ")}`,
    );
  }
  if (repoCtx.container?.hasDockerfile) parts.push("Has Dockerfile");
  if (repoCtx.infra?.hasTerraform) parts.push("Has Terraform");
  if (repoCtx.infra?.hasKubernetes) parts.push("Has Kubernetes");
  if (repoCtx.meta?.isMonorepo) parts.push("Monorepo");
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function writeRawOutput(content: string): void {
  process.stdout.write(content);
  if (!content.endsWith("\n")) process.stdout.write("\n");
}

function validateWritePath(writePath: string, allowAllPaths: boolean): void {
  if (!allowAllPaths && !isDevOpsFile(writePath)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Write to "${writePath}" blocked: not a recognized DevOps file. Use --allow-all-paths to bypass.`,
    );
  }
}

function backupAndWrite(writePath: string, content: string, verbose: boolean): void {
  if (fs.existsSync(writePath)) {
    fs.copyFileSync(writePath, writePath + ".bak");
    if (verbose) {
      p.log.info(`Backup created: ${writePath}.bak`);
    }
  }
  fs.writeFileSync(writePath, content, "utf-8");
}

function outputFormatted(
  outputMode: string | undefined,
  key: string,
  name: string,
  content: string,
): void {
  if (outputMode === "json") {
    console.log(JSON.stringify({ [key]: name, content }));
  } else if (outputMode === "yaml") {
    console.log("---");
    console.log(`${key}: ${name}`);
    console.log("content: |");
    for (const line of content.split("\n")) {
      console.log(`  ${line}`);
    }
  } else if (process.stdout.isTTY) {
    p.log.message(content);
  } else {
    process.stdout.write(content);
  }
}

async function handleToolDirect(
  ctx: CLIContext,
  prompt: string,
  writePath: string | undefined,
  allowAllPaths: boolean,
  toolName: string,
  provider: ReturnType<CLIContext["getProvider"]>,
  projectRoot: string | undefined,
  docAugmenter: DocAugmenter | undefined,
  context7Provider: Context7Provider | undefined,
  projectContextStr: string | undefined,
): Promise<void> {
  const registry = createToolRegistry(provider, projectRoot, {
    docAugmenter,
    context7Provider,
    projectContext: projectContextStr,
  });
  const tool = registry.get(toolName);
  if (!tool) {
    const available = registry
      .getAll()
      .map((t) => t.name)
      .join(", ");
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Module "${toolName}" not found. Available: ${available}`,
    );
  }

  if (ctx.globalOpts.output !== "json") {
    p.log.info(`Using module: ${pc.bold(toolName)} (forced via --module)`);
  }

  const structured = isStructuredOutput(ctx);
  const s = p.spinner();
  if (!structured) s.start("Generating...");
  const result = await tool.generate({ prompt });
  if (!structured) s.stop("Done.");

  const content = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  if (ctx.globalOpts.raw) {
    writeRawOutput(content);
    return;
  }

  if (writePath) {
    validateWritePath(writePath, allowAllPaths);
    backupAndWrite(writePath, content, false);
    if (ctx.globalOpts.output === "json") {
      console.log(JSON.stringify({ tool: toolName, content, written: writePath }));
    } else {
      p.log.success(`Written to ${pc.underline(writePath)}`);
    }
    return;
  }

  outputFormatted(ctx.globalOpts.output, "tool", toolName, content);
}

function resolveForcedAgent(
  ctx: CLIContext,
  router: ReturnType<typeof createRouter>["router"],
  agentName: string,
) {
  const agents = router.getAgents();
  const match = agents.find((a) => a.name === agentName || a.name.startsWith(agentName));
  if (!match) {
    const available = agents.map((a) => a.name).join(", ");
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Unknown agent: "${agentName}". Available: ${available}`,
    );
  }
  if (ctx.globalOpts.output !== "json") {
    p.log.info(`Using agent: ${pc.bold(match.name)} (forced via --agent)`);
  }
  return { agent: match, confidence: 1, reason: `Forced via --agent ${agentName}` } as ReturnType<
    typeof router.route
  >;
}

function routeWithSpinner(
  ctx: CLIContext,
  router: ReturnType<typeof createRouter>["router"],
  prompt: string,
  projectDomains: string[],
) {
  const isStructured = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  const s = p.spinner();
  if (!isStructured) s.start("Routing to specialist agent...");
  const route = router.route(prompt, { projectDomains });
  if (!isStructured) {
    const msg =
      route.confidence > 0
        ? `Routed to ${pc.bold(route.agent.name)} — ${route.reason}`
        : "Using default agent.";
    s.stop(msg);
  }
  if (ctx.globalOpts.verbose) {
    p.log.info(
      `Agent: ${pc.bold(route.agent.name)} (confidence: ${route.confidence.toFixed(2)}, domain: ${route.agent.domain})`,
    );
  }
  return route;
}

function resolveRoute(
  ctx: CLIContext,
  router: ReturnType<typeof createRouter>["router"],
  prompt: string,
  projectDomains: string[],
) {
  const agentName = ctx.globalOpts.agent;
  if (agentName) return resolveForcedAgent(ctx, router, agentName);
  return routeWithSpinner(ctx, router, prompt, projectDomains);
}

function augmentPromptWithContext(prompt: string, projectRoot: string | undefined): string {
  if (!projectRoot) return prompt;

  const repoContext = loadContext(projectRoot);
  if (!repoContext) return prompt;

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
    return `${prompt}\n\n[Project context: ${contextParts.join("; ")}]`;
  }
  return prompt;
}

function isUpdateRequest(lowerPrompt: string): boolean {
  return (
    lowerPrompt.includes("update") ||
    lowerPrompt.includes("modify") ||
    lowerPrompt.includes("change") ||
    lowerPrompt.includes("fix") ||
    lowerPrompt.includes("improve") ||
    lowerPrompt.includes("add to")
  );
}

function matchesToolKey(lowerPrompt: string, toolKey: string): boolean {
  return lowerPrompt.includes(toolKey) || lowerPrompt.includes(toolKey.replace("-", " "));
}

function appendExistingFileContext(
  result: string,
  toolKey: string,
  cwd: string,
  verbose: boolean,
): string {
  const existing = readExistingToolFile(toolKey, cwd);
  if (!existing) return result;

  if (verbose) {
    p.log.info(
      `Detected existing file: ${pc.cyan(existing.filePath)} (${existing.content.length} bytes)`,
    );
  }
  return (
    result +
    `\n\n[Existing ${existing.filePath} content for reference — update this rather than creating from scratch]:\n\`\`\`\n${existing.content}\n\`\`\``
  );
}

function augmentPromptWithExistingFiles(
  augmentedPrompt: string,
  prompt: string,
  verbose: boolean,
): string {
  if (!isUpdateRequest(prompt.toLowerCase())) return augmentedPrompt;

  const cwd = process.cwd();
  const lowerPrompt = prompt.toLowerCase();
  let result = augmentedPrompt;
  for (const toolKey of Object.keys(TOOL_FILE_MAP)) {
    if (!matchesToolKey(lowerPrompt, toolKey)) continue;
    result = appendExistingFileContext(result, toolKey, cwd, verbose);
  }
  return result;
}

function handleWriteOutput(
  ctx: CLIContext,
  writePath: string,
  allowAllPaths: boolean,
  content: string,
  agentName: string,
): void {
  validateWritePath(writePath, allowAllPaths);
  backupAndWrite(writePath, content, ctx.globalOpts.verbose);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ agent: agentName, content, written: writePath }));
  } else {
    p.log.success(`Written to ${pc.underline(writePath)}`);
  }
}

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

  const { docAugmenter, context7Provider } = await initContext7();
  const projectContextStr = buildProjectContextString(projectRoot);

  const toolName = ctx.globalOpts.tool;
  if (toolName) {
    await handleToolDirect(
      ctx,
      prompt,
      writePath,
      allowAllPaths,
      toolName,
      provider,
      projectRoot,
      docAugmenter,
      context7Provider,
      projectContextStr,
    );
    return;
  }

  const { router } = createRouter(provider, projectRoot, docAugmenter);

  const projectDomains: string[] = projectRoot
    ? (loadContext(projectRoot)?.relevantDomains ?? [])
    : [];

  const route = resolveRoute(ctx, router, prompt, projectDomains);

  const canProceed = preflightCheck(route.agent.name, route.agent.toolDependencies, {
    quiet: ctx.globalOpts.quiet || ctx.globalOpts.output === "json",
  });
  if (!canProceed) {
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }

  let augmentedPrompt = augmentPromptWithContext(prompt, projectRoot);
  augmentedPrompt = augmentPromptWithExistingFiles(augmentedPrompt, prompt, ctx.globalOpts.verbose);

  const structured = isStructuredOutput(ctx);
  const s2 = p.spinner();
  if (!structured) s2.start("Thinking...");
  const genStart = Date.now();
  const result = await route.agent.run({ prompt: sanitizeUserInput(augmentedPrompt) });
  const genDuration = Date.now() - genStart;
  if (!structured) s2.stop("Done.");

  if (ctx.globalOpts.verbose) {
    p.log.info(`Generation completed in ${genDuration}ms (${result.content.length} chars)`);
  }

  if (ctx.globalOpts.raw) {
    writeRawOutput(result.content);
    return;
  }

  if (writePath) {
    handleWriteOutput(ctx, writePath, allowAllPaths, result.content, route.agent.name);
    return;
  }

  outputFormatted(ctx.globalOpts.output, "agent", route.agent.name, result.content);
}
