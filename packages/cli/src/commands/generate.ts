import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@dojops/api";
import { sanitizeUserInput, scanRepo } from "@dojops/core";
import { isDevOpsFile, SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createToolRegistry, discoverUserDopsFiles } from "@dojops/tool-registry";
import { CLIContext } from "../types";
import { preflightCheck } from "../preflight";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue, hasFlag } from "../parser";
import { findProjectRoot, loadContext, saveLastGeneration, loadLastGeneration } from "../state";
import crypto from "node:crypto";
import { TOOL_FILE_MAP, readExistingToolFile } from "../tool-file-map";
import { runHooks } from "../hooks";
import { appendActivity } from "../dojops-md";
import { recordTask, queryMemory, buildMemoryContextString } from "../memory";
import { classifyTaskRisk } from "../risk-classifier";
import { cliApprovalHandler } from "../approval";
import { createAutoInstallHandler } from "../toolchain-sandbox";

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
  if (process.env.DOJOPS_CONTEXT_ENABLED === "false") {
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

function freshContext(projectRoot: string): ReturnType<typeof loadContext> {
  try {
    return scanRepo(projectRoot);
  } catch {
    return loadContext(projectRoot);
  }
}

function buildProjectContextString(projectRoot: string | undefined): string | undefined {
  if (!projectRoot) return undefined;
  const repoCtx = freshContext(projectRoot);
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

function writeFileContent(
  writePath: string,
  content: string,
): "created" | "modified" | "unchanged" {
  if (fs.existsSync(writePath)) {
    const existing = fs.readFileSync(writePath, "utf-8");
    if (existing === content) return "unchanged";
    fs.writeFileSync(writePath, content, "utf-8");
    return "modified";
  }
  const dir = path.dirname(writePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(writePath, content, "utf-8");
  return "created";
}

/** @internal exported for testing */
export function outputFormatted(
  outputMode: string | undefined,
  key: string,
  name: string,
  content: string,
): void {
  if (outputMode === "json") {
    let contentValue: unknown = content;
    try {
      contentValue = JSON.parse(content);
    } catch {
      // content is not JSON — use as-is (string)
    }
    console.log(JSON.stringify({ [key]: name, content: contentValue }, null, 2));
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

/** Module name → prompt keywords for auto-detection. */
const MODULE_KEYWORDS: Record<string, string[]> = {
  jenkinsfile: ["jenkinsfile", "jenkins pipeline", "jenkins ci", "jenkins cd"],
  "github-actions": ["github actions", "github workflow", "github ci"],
  "gitlab-ci": ["gitlab ci", "gitlab pipeline", "gitlab-ci"],
  terraform: ["terraform", "hcl", "infrastructure as code"],
  kubernetes: ["kubernetes", "k8s", "kubectl"],
  helm: ["helm chart", "helm"],
  ansible: ["ansible", "playbook"],
  "docker-compose": ["docker-compose", "docker compose", "compose file"],
  dockerfile: ["dockerfile", "docker image", "docker build"],
  nginx: ["nginx", "reverse proxy"],
  prometheus: ["prometheus", "alerting rules", "prom"],
  systemd: ["systemd", "service unit", "systemctl"],
  makefile: ["makefile", "make target"],
};

/**
 * Auto-detect a module from the prompt based on keyword matching.
 * Returns the module name if a strong match is found, undefined otherwise.
 */
export function autoDetectModule(prompt: string): string | undefined {
  const lower = prompt.toLowerCase();
  for (const [moduleName, keywords] of Object.entries(MODULE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return moduleName;
    }
  }
  return undefined;
}

/**
 * Auto-detect an installed (hub/custom) module by matching .dops filenames against the prompt.
 * Only checks names not already covered by MODULE_KEYWORDS.
 */
export function autoDetectInstalledModule(
  prompt: string,
  projectRoot: string | undefined,
): string | undefined {
  const dopsFiles = discoverUserDopsFiles(projectRoot);
  if (dopsFiles.length === 0) return undefined;

  const lower = prompt.toLowerCase();
  for (const entry of dopsFiles) {
    const name = path.basename(entry.filePath, ".dops");
    if (MODULE_KEYWORDS[name]) continue;
    const lowerName = name.toLowerCase();
    if (lower.includes(lowerName) || lower.includes(lowerName.replaceAll("-", " "))) {
      return name;
    }
  }
  return undefined;
}

interface ToolDirectContext {
  provider: ReturnType<CLIContext["getProvider"]>;
  projectRoot: string | undefined;
  docAugmenter?: DocAugmenter;
  context7Provider?: Context7Provider;
  projectContextStr?: string;
}

function resolveToolOrThrow(
  registry: ReturnType<typeof createToolRegistry>,
  toolName: string,
): NonNullable<ReturnType<ReturnType<typeof createToolRegistry>["get"]>> {
  const tool = registry.get(toolName);
  if (tool) return tool;

  const available = registry
    .getAll()
    .map((t) => t.name)
    .join(", ");
  throw new CLIError(
    ExitCode.VALIDATION_ERROR,
    `Module "${toolName}" not found. Available: ${available}`,
  );
}

async function buildCritic(
  provider: ReturnType<CLIContext["getProvider"]>,
): Promise<import("@dojops/executor").CriticCallback | undefined> {
  try {
    const { CriticAgent } = await import("@dojops/core");
    return new CriticAgent(provider);
  } catch {
    return undefined;
  }
}

function injectMemoryContext(prompt: string, projectRoot: string | undefined): string {
  if (!projectRoot) return prompt;
  const memCtx = queryMemory(projectRoot, "generate", prompt);
  const memoryStr = buildMemoryContextString(memCtx);
  return memoryStr ? `${prompt}\n\n${memoryStr}` : prompt;
}

function buildSafeExecutorForTool(
  ctx: CLIContext,
  writePath: string | undefined,
  allowAllPaths: boolean,
  maxRepairAttempts: number,
  critic: import("@dojops/executor").CriticCallback | undefined,
  structured: boolean,
): SafeExecutor {
  const autoApprove = ctx.globalOpts.nonInteractive || ctx.globalOpts.dryRun;
  return new SafeExecutor({
    policy: {
      allowWrite: !!writePath,
      requireApproval: !autoApprove,
      approvalMode: autoApprove ? "never" : "risk-based",
      autoApproveRiskLevel: "MEDIUM",
      timeoutMs: ctx.globalOpts.timeout ?? 60_000,
      skipVerification: false,
      enforceDevOpsAllowlist: !allowAllPaths,
      maxRepairAttempts,
    },
    approvalHandler: autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    critic,
    progress: structured
      ? undefined
      : {
          onVerificationFailed(_taskId, errors) {
            p.log.warn(
              `Verification failed (${errors.length} error${errors.length === 1 ? "" : "s"}). Starting self-repair...`,
            );
          },
          onRepairAttempt(_taskId, attempt, maxAttempts) {
            p.log.info(`${pc.yellow("↻")} Self-repair attempt ${attempt}/${maxAttempts}...`);
          },
          onVerificationPassed() {
            p.log.success("Self-repair succeeded — verification passed.");
          },
        },
  });
}

function extractContentFromResult(execResult: { output?: unknown }): string {
  const outputData = execResult.output as Record<string, unknown> | string | undefined;
  if (typeof outputData === "string") return outputData;
  if (typeof outputData?.generated === "string") return outputData.generated;
  return JSON.stringify(outputData, null, 2);
}

function trackToolActivity(
  projectRoot: string,
  prompt: string,
  toolName: string,
  writePath: string | undefined,
  durationMs: number | undefined,
): void {
  const files = writePath ? ` \`${writePath}\`` : "";
  const filesWritten = writePath ? [writePath] : [];
  appendActivity(projectRoot, `Generated${files} (${toolName})`);
  recordTask(projectRoot, {
    timestamp: new Date().toISOString(),
    task_type: "generate",
    prompt,
    result_summary: `Generated${files} (${toolName})`,
    status: "success",
    duration_ms: durationMs ?? 0,
    related_files: JSON.stringify(filesWritten),
    agent_or_module: toolName,
    metadata: "{}",
  });
}

function outputWriteResult(
  ctx: CLIContext,
  writePath: string,
  allowAllPaths: boolean,
  toolName: string,
  content: string,
): void {
  validateWritePath(writePath, allowAllPaths);
  if (ctx.globalOpts.dryRun) {
    p.log.info(`${pc.yellow("[dry-run]")} Would write to ${pc.underline(writePath)}`);
    outputFormatted(ctx.globalOpts.output, "module", toolName, content);
    return;
  }
  const action = writeFileContent(writePath, content);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ module: toolName, content, written: writePath, action }));
    return;
  }
  if (action === "unchanged") {
    p.log.info(`${pc.dim("○")} ${pc.underline(writePath)} ${pc.dim("(unchanged)")}`);
    return;
  }
  const label = action === "created" ? pc.green("+ created") : pc.yellow("~ modified");
  p.log.success(`${label} ${pc.underline(writePath)}`);
}

async function handleToolDirect(
  ctx: CLIContext,
  args: string[],
  prompt: string,
  writePath: string | undefined,
  allowAllPaths: boolean,
  toolName: string,
  toolCtx: ToolDirectContext,
): Promise<void> {
  const registry = createToolRegistry(toolCtx.provider, toolCtx.projectRoot, {
    docAugmenter: toolCtx.docAugmenter,
    context7Provider: toolCtx.context7Provider,
    projectContext: toolCtx.projectContextStr,
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
  });
  const tool = resolveToolOrThrow(registry, toolName);

  if (ctx.globalOpts.output !== "json") {
    const reason = ctx.globalOpts.tool ? "forced via --module" : "auto-detected";
    p.log.info(`Using module: ${pc.bold(toolName)} (${reason})`);
  }

  const structured = isStructuredOutput(ctx);
  const taskRisk = classifyTaskRisk({ tool: toolName, description: prompt });
  const repairAttempts = extractFlagValue(args, "--repair-attempts");
  const maxRepairAttempts = repairAttempts ? Number.parseInt(repairAttempts, 10) : 3;

  const critic = await buildCritic(toolCtx.provider);
  const memoryPrompt = injectMemoryContext(prompt, toolCtx.projectRoot);

  const safeExecutor = buildSafeExecutorForTool(
    ctx,
    writePath,
    allowAllPaths,
    maxRepairAttempts,
    critic,
    structured,
  );

  const s = p.spinner();
  if (!structured) s.start("Generating...");

  const taskId = `gen-${toolName}-${Date.now()}`;
  const execResult = await safeExecutor.executeTask(
    taskId,
    tool,
    { prompt: memoryPrompt },
    { risk: taskRisk },
  );

  if (!structured) s.stop("Done.");

  if (execResult.status === "denied") {
    p.log.warn("Generation denied by approval policy.");
    return;
  }

  if (execResult.status === "failed" || execResult.status === "timeout") {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      execResult.error ?? `Generation ${execResult.status}`,
    );
  }

  const content = extractContentFromResult(execResult);

  // Persist generation for cross-command memory
  const filesWritten = writePath ? [writePath] : [];
  persistGeneration(toolCtx.projectRoot, prompt, content, { toolName, filesWritten });

  if (toolCtx.projectRoot) {
    trackToolActivity(toolCtx.projectRoot, prompt, toolName, writePath, execResult.durationMs);
  }

  if (ctx.globalOpts.raw) {
    writeRawOutput(content);
    return;
  }

  if (writePath) {
    outputWriteResult(ctx, writePath, allowAllPaths, toolName, content);
    return;
  }

  outputFormatted(ctx.globalOpts.output, "module", toolName, content);
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

  const repoContext = freshContext(projectRoot);
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

const FOLLOW_UP_VERBS = [
  "update",
  "modify",
  "change",
  "fix",
  "improve",
  "add to",
  "split",
  "refactor",
  "extract",
  "reorganize",
  "separate",
  "break",
  "convert",
  "move",
  "rename",
  "migrate",
  "restructure",
];

function isUpdateRequest(lowerPrompt: string): boolean {
  return FOLLOW_UP_VERBS.some((verb) => lowerPrompt.includes(verb));
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

/** Max age for last-generation context injection (1 hour). */
const LAST_GEN_MAX_AGE_MS = 60 * 60 * 1000;

function augmentPromptWithLastGeneration(
  prompt: string,
  projectRoot: string | undefined,
  verbose: boolean,
): string {
  if (!projectRoot) return prompt;
  if (!isUpdateRequest(prompt.toLowerCase())) return prompt;

  const lastGen = loadLastGeneration(projectRoot);
  if (!lastGen) return prompt;

  // Only inject if recent
  const age = Date.now() - new Date(lastGen.timestamp).getTime();
  if (age > LAST_GEN_MAX_AGE_MS) return prompt;

  if (verbose) {
    const source = lastGen.toolName ?? lastGen.agentName ?? "unknown";
    p.log.info(`Injecting previous generation context (${source}, ${Math.round(age / 1000)}s ago)`);
  }

  const truncatedContent =
    lastGen.content.length > 8000
      ? lastGen.content.slice(0, 8000) + "\n... (truncated)"
      : lastGen.content;

  return (
    prompt +
    `\n\n[Previous generation (prompt: "${lastGen.prompt}") for reference — build on this]:\n` +
    "```\n" +
    truncatedContent +
    "\n```"
  );
}

function persistGeneration(
  projectRoot: string | undefined,
  prompt: string,
  content: string,
  opts: { toolName?: string; agentName?: string; filesWritten?: string[] },
): void {
  if (!projectRoot) return;
  saveLastGeneration(projectRoot, {
    timestamp: new Date().toISOString(),
    prompt,
    toolName: opts.toolName,
    agentName: opts.agentName,
    content,
    filesWritten: opts.filesWritten ?? [],
    contentHash: crypto.createHash("sha256").update(content).digest("hex"),
  });
}

async function handleWriteOutput(
  ctx: CLIContext,
  writePath: string,
  allowAllPaths: boolean,
  content: string,
  agentName: string,
): Promise<void> {
  validateWritePath(writePath, allowAllPaths);

  // Gate writes to sensitive paths with approval (e.g., .env, .ssh, tfstate)
  const { classifyPathRisk, isRiskAtOrBelow } = await import("@dojops/executor");
  const pathRisk = classifyPathRisk(writePath);
  if (!isRiskAtOrBelow(pathRisk, "MEDIUM") && !ctx.globalOpts.nonInteractive) {
    const riskLabel = pc.yellow(`\u26A0 ${pathRisk} risk path:`);
    const confirmed = await p.confirm({
      message: `${riskLabel} Write to ${pc.underline(writePath)}?`,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.log.warn("Write cancelled due to path risk.");
      return;
    }
  }

  if (ctx.globalOpts.dryRun) {
    p.log.info(`${pc.yellow("[dry-run]")} Would write to ${pc.underline(writePath)}`);
    outputFormatted(ctx.globalOpts.output, "agent", agentName, content);
    return;
  }
  const action = writeFileContent(writePath, content);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ agent: agentName, content, written: writePath, action }));
  } else if (action === "unchanged") {
    p.log.info(`${pc.dim("○")} ${pc.underline(writePath)} ${pc.dim("(unchanged)")}`);
  } else {
    const label = action === "created" ? pc.green("+ created") : pc.yellow("~ modified");
    p.log.success(`${label} ${pc.underline(writePath)}`);
  }
}

function runPreGenerateHook(
  projectRoot: string | undefined,
  prompt: string,
  verbose: boolean,
): void {
  if (!projectRoot) return;
  const hookOk = runHooks(projectRoot, "pre-generate", { prompt }, { verbose });
  if (!hookOk) throw new CLIError(ExitCode.GENERAL_ERROR, "Pre-generate hook failed.");
}

function tryToolDirectPath(
  ctx: CLIContext,
  prompt: string,
  projectRoot: string | undefined,
  provider: ReturnType<CLIContext["getProvider"]>,
  docAugmenter: DocAugmenter | undefined,
  context7Provider: Context7Provider | undefined,
  projectContextStr: string | undefined,
): { toolName: string; toolCtx: ToolDirectContext; registryHasTool: boolean } | null {
  const toolName =
    ctx.globalOpts.tool ??
    autoDetectModule(prompt) ??
    autoDetectInstalledModule(prompt, projectRoot);
  if (!toolName) return null;

  const toolCtx = { provider, projectRoot, docAugmenter, context7Provider, projectContextStr };
  const registry = createToolRegistry(provider, projectRoot, {
    docAugmenter,
    context7Provider,
    projectContext: projectContextStr,
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
  });
  return { toolName, toolCtx, registryHasTool: !!registry.get(toolName) };
}

function buildAugmentedPrompt(
  prompt: string,
  projectRoot: string | undefined,
  verbose: boolean,
): string {
  let augmented = augmentPromptWithContext(prompt, projectRoot);
  augmented = augmentPromptWithExistingFiles(augmented, prompt, verbose);
  augmented = augmentPromptWithLastGeneration(augmented, projectRoot, verbose);
  return injectMemoryContext(augmented, projectRoot);
}

function trackAgentActivity(
  projectRoot: string,
  prompt: string,
  agentName: string,
  writePath: string | undefined,
  genDuration: number,
): void {
  appendActivity(projectRoot, `Agent "${agentName}" generation`);
  recordTask(projectRoot, {
    timestamp: new Date().toISOString(),
    task_type: "generate",
    prompt,
    result_summary: `Agent "${agentName}" generation`,
    status: "success",
    duration_ms: genDuration,
    related_files: JSON.stringify(writePath ? [writePath] : []),
    agent_or_module: agentName,
    metadata: "{}",
  });
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

  const projectRoot = findProjectRoot() ?? undefined;
  runPreGenerateHook(projectRoot, prompt, ctx.globalOpts.verbose);

  const provider = ctx.getProvider();
  const { docAugmenter, context7Provider } = await initContext7();
  const projectContextStr = buildProjectContextString(projectRoot);

  const toolDirect = tryToolDirectPath(
    ctx,
    prompt,
    projectRoot,
    provider,
    docAugmenter,
    context7Provider,
    projectContextStr,
  );
  if (toolDirect?.registryHasTool) {
    await handleToolDirect(
      ctx,
      args,
      prompt,
      writePath,
      allowAllPaths,
      toolDirect.toolName,
      toolDirect.toolCtx,
    );
    return;
  }

  const { router } = createRouter(provider, projectRoot, docAugmenter);
  const projectDomains: string[] = projectRoot
    ? (freshContext(projectRoot)?.relevantDomains ?? [])
    : [];

  const route = resolveRoute(ctx, router, prompt, projectDomains);

  const canProceed = preflightCheck(route.agent.name, route.agent.toolDependencies, {
    quiet: ctx.globalOpts.quiet || ctx.globalOpts.output === "json",
  });
  if (!canProceed) {
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }

  const augmentedPrompt = buildAugmentedPrompt(prompt, projectRoot, ctx.globalOpts.verbose);

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

  persistGeneration(projectRoot, prompt, result.content, {
    agentName: route.agent.name,
    filesWritten: writePath ? [writePath] : [],
  });

  if (projectRoot) {
    trackAgentActivity(projectRoot, prompt, route.agent.name, writePath, genDuration);
  }

  if (ctx.globalOpts.raw) {
    writeRawOutput(result.content);
    return;
  }

  if (writePath) {
    await handleWriteOutput(ctx, writePath, allowAllPaths, result.content, route.agent.name);
    return;
  }

  outputFormatted(ctx.globalOpts.output, "agent", route.agent.name, result.content);

  if (projectRoot) {
    runHooks(
      projectRoot,
      "post-generate",
      { prompt, agent: route.agent.name, outputPath: writePath },
      { verbose: ctx.globalOpts.verbose },
    );
  }
}
