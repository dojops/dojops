import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createRouter } from "@dojops/api";
import { sanitizeUserInput, scanRepo } from "@dojops/core";
import { isDevOpsFile, SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { createSkillRegistry, discoverUserDopsFiles } from "@dojops/skill-registry";
import { CLIContext } from "../types";
import { preflightCheck } from "../preflight";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue, hasFlag } from "../parser";
import { readPromptFile } from "../stdin";
import { findProjectRoot, loadContext, saveLastGeneration, loadLastGeneration } from "../state";
import crypto from "node:crypto";
import { TOOL_FILE_MAP, readExistingToolFile } from "../tool-file-map";
import { runHooks } from "../hooks";
import { appendActivity } from "../dojops-md";
import { recordTask, recordOutcome, queryMemory, buildMemoryContextString } from "../memory";
import { classifyTaskRisk } from "../risk-classifier";
import { cliApprovalHandler } from "../approval";
import { createAutoInstallHandler } from "../toolchain-sandbox";
import { buildFileTree } from "@dojops/session";
import { stripCodeFences } from "@dojops/runtime";
import { emitStreamEvent } from "../stream-json";
import { trySkillFallback } from "../skill-fallback";
import {
  makeExecutable,
  checkShebang,
  validateScript,
  isScriptFile,
  cleanScriptContent,
} from "../script-utils";

type DocAugmenter = { augmentPrompt(s: string, kw: string[], q: string): Promise<string> };
type Context7Provider = {
  resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
  queryDocs(libraryId: string, query: string): Promise<string>;
};

function isStructuredOutput(ctx: CLIContext): boolean {
  return (
    ctx.globalOpts.output === "json" ||
    ctx.globalOpts.output === "yaml" ||
    ctx.globalOpts.output === "stream-json" ||
    ctx.globalOpts.raw
  );
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

  // Include file tree so LLM knows actual project structure
  const tree = buildFileTree(projectRoot);
  if (tree) parts.push(`\nProject files:\n${tree}`);

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

/**
 * If content is a JSON `{ "files": { "path": "content", ... } }` object,
 * render each file with a header and code block for human readability.
 */
function tryRenderFileBlocks(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.files ||
      typeof parsed.files !== "object"
    ) {
      return null;
    }
    const entries = Object.entries(parsed.files as Record<string, string>);
    if (entries.length === 0) return null;

    const blocks: string[] = [];
    for (const [filePath, fileContent] of entries) {
      if (typeof fileContent !== "string") continue;
      const ext = filePath.split(".").pop() ?? "";
      blocks.push(
        `${pc.cyan("─")} ${pc.bold(filePath)}`,
        `${pc.dim("```" + ext)}`,
        fileContent,
        pc.dim("```"),
        "",
      );
    }
    return blocks.join("\n");
  } catch {
    return null;
  }
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
    // If the LLM returned a JSON { files: { ... } } object, render each file block
    // with filename headers instead of dumping raw JSON.
    const rendered = tryRenderFileBlocks(content);
    p.log.message(rendered ?? content);
  } else {
    process.stdout.write(content);
  }
}

/** Skill name → prompt keywords for auto-detection. */
const SKILL_KEYWORDS: Record<string, string[]> = {
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
  grafana: ["grafana", "dashboard", "visualization", "panel"],
  cloudformation: ["cloudformation", "cfn", "aws template", "aws stack"],
  argocd: ["argocd", "argo cd", "argo rollout", "argo"],
  pulumi: ["pulumi"],
  packer: ["packer", "machine image", "ami build", "golden image", "pkr.hcl", "vm image"],
  "otel-collector": ["opentelemetry", "otel", "collector", "telemetry"],
  "azure-devops": ["azure devops", "azure pipeline", "ado pipeline", "azure-pipelines"],
  "aws-codepipeline": ["codebuild", "buildspec", "codepipeline", "aws pipeline", "aws ci"],
  circleci: ["circleci", "circle ci", "circle pipeline"],
  "bitbucket-pipelines": ["bitbucket pipeline", "bitbucket ci", "bitbucket-pipelines"],
  // PowerShell MUST come before shell — "powershell script" contains "shell script"
  powershell: [
    "powershell script",
    "powershell file",
    "ps1 script",
    "ps1 file",
    "pwsh script",
    "powershell module",
    "cmdlet",
  ],
  python: [
    "python script",
    "python file",
    "py script",
    ".py file",
    "python utility",
    "python tool",
    "python automation",
    "python cli",
    "boto3 script",
    "fabric script",
  ],
  shell: [
    "bash script",
    "shell script",
    "sh script",
    "zsh script",
    "bash file",
    "shell file",
    ".sh file",
    "write a script",
    "create a script",
    "generate a script",
    "entrypoint script",
    "init script",
    "setup script",
    "deploy script",
    "backup script",
    "cron script",
    "wrapper script",
  ],
};

/**
 * Detect if the prompt is asking for analysis/review rather than generation.
 * Analysis prompts should route to specialist agents, not skills.
 */
export function isAnalysisIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  // Question patterns — user is asking about existing infrastructure
  const questionPatterns = [
    /^(what|how|why|is|are|do|does|can|could|should|would|tell|explain|describe|show)\b/,
    /\b(analy[sz]e|review|check|evaluate|audit|inspect|assess|examine|look at)\b/,
    /\b(think about|opinion|feedback|improve|missing|wrong|issue|problem)\b/,
    /\b(good|bad|correct|best practice|recommend)\b.*\?/,
    /\?\s*$/,
  ];
  return questionPatterns.some((p) => p.test(lower));
}

/**
 * Auto-detect a skill from the prompt based on keyword matching.
 * Returns the skill name if a strong match is found, undefined otherwise.
 * Skips detection when the prompt is an analysis/review question.
 */
export function autoDetectSkill(prompt: string): string | undefined {
  if (isAnalysisIntent(prompt)) return undefined;
  const lower = prompt.toLowerCase();
  for (const [skillName, keywords] of Object.entries(SKILL_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return skillName;
    }
  }
  return undefined;
}

/**
 * Auto-detect an installed (hub/custom) skill by matching .dops filenames against the prompt.
 * Only checks names not already covered by SKILL_KEYWORDS.
 */
export function autoDetectInstalledSkill(
  prompt: string,
  projectRoot: string | undefined,
): string | undefined {
  const dopsFiles = discoverUserDopsFiles(projectRoot);
  if (dopsFiles.length === 0) return undefined;

  const lower = prompt.toLowerCase();
  for (const entry of dopsFiles) {
    const name = path.basename(entry.filePath, ".dops");
    if (SKILL_KEYWORDS[name]) continue;
    const lowerName = name.toLowerCase();
    if (lower.includes(lowerName) || lower.includes(lowerName.replaceAll("-", " "))) {
      return name;
    }
  }
  return undefined;
}

interface SkillDirectContext {
  provider: ReturnType<CLIContext["getProvider"]>;
  projectRoot: string | undefined;
  docAugmenter?: DocAugmenter;
  context7Provider?: Context7Provider;
  projectContextStr?: string;
}

function resolveSkillOrThrow(
  registry: ReturnType<typeof createSkillRegistry>,
  skillName: string,
): NonNullable<ReturnType<ReturnType<typeof createSkillRegistry>["get"]>> {
  const tool = registry.get(skillName);
  if (tool) return tool;

  const available = registry
    .getAll()
    .map((t) => t.name)
    .join(", ");
  throw new CLIError(
    ExitCode.VALIDATION_ERROR,
    `Skill "${skillName}" not found. Available: ${available}`,
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

function buildSafeExecutorForSkill(
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
      timeoutMs: ctx.globalOpts.timeout ?? 120_000,
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
  skillName: string,
  writePath: string | undefined,
  durationMs: number | undefined,
): void {
  const files = writePath ? ` \`${writePath}\`` : "";
  const filesWritten = writePath ? [writePath] : [];
  appendActivity(projectRoot, `Generated${files} (${skillName})`);
  recordTask(projectRoot, {
    timestamp: new Date().toISOString(),
    task_type: "generate",
    prompt,
    result_summary: `Generated${files} (${skillName})`,
    status: "success",
    duration_ms: durationMs ?? 0,
    related_files: JSON.stringify(filesWritten),
    agent_or_skill: skillName,
    metadata: "{}",
  });
  recordOutcome(projectRoot, {
    task_type: "generate",
    skill_name: skillName,
    model: "",
    tier: "",
    status: "success",
    quality_score: 1.0,
    duration_ms: durationMs ?? 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_estimate: 0,
    repair_attempts: 0,
    error_summary: "",
  });
}

function outputWriteResult(
  ctx: CLIContext,
  writePath: string,
  allowAllPaths: boolean,
  skillName: string,
  content: string,
): void {
  validateWritePath(writePath, allowAllPaths);
  if (ctx.globalOpts.dryRun) {
    p.log.info(`${pc.yellow("[dry-run]")} Would write to ${pc.underline(writePath)}`);
    outputFormatted(ctx.globalOpts.output, "skill", skillName, content);
    return;
  }
  const action = writeFileContent(writePath, content);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ skill: skillName, content, written: writePath, action }));
    return;
  }
  if (action === "unchanged") {
    p.log.info(`${pc.dim("○")} ${pc.underline(writePath)} ${pc.dim("(unchanged)")}`);
    return;
  }
  const label = action === "created" ? pc.green("+ created") : pc.yellow("~ modified");
  p.log.success(`${label} ${pc.underline(writePath)}`);
}

async function handleSkillDirect(
  ctx: CLIContext,
  args: string[],
  prompt: string,
  writePath: string | undefined,
  allowAllPaths: boolean,
  skillName: string,
  skillCtx: SkillDirectContext,
): Promise<void> {
  const registry = createSkillRegistry(skillCtx.provider, skillCtx.projectRoot, {
    docAugmenter: skillCtx.docAugmenter,
    context7Provider: skillCtx.context7Provider,
    projectContext: skillCtx.projectContextStr,
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
  });
  const tool = resolveSkillOrThrow(registry, skillName);

  if (ctx.globalOpts.output !== "json") {
    const reason = ctx.globalOpts.skill ? "forced via --skill" : "auto-detected";
    p.log.info(`Using skill: ${pc.bold(skillName)} (${reason})`);
  }

  const structured = isStructuredOutput(ctx);
  const taskRisk = classifyTaskRisk({ tool: skillName, description: prompt });
  const repairAttempts = extractFlagValue(args, "--repair-attempts");
  const maxRepairAttempts = repairAttempts ? Number.parseInt(repairAttempts, 10) : 3;

  const critic = await buildCritic(skillCtx.provider);
  const memoryPrompt = sanitizeUserInput(injectMemoryContext(prompt, skillCtx.projectRoot));

  const safeExecutor = buildSafeExecutorForSkill(
    ctx,
    writePath,
    allowAllPaths,
    maxRepairAttempts,
    critic,
    structured,
  );

  const s = p.spinner();
  if (!structured) s.start("Generating...");

  const taskId = `gen-${skillName}-${Date.now()}`;
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
  persistGeneration(skillCtx.projectRoot, prompt, content, { skillName, filesWritten });

  if (skillCtx.projectRoot) {
    trackToolActivity(skillCtx.projectRoot, prompt, skillName, writePath, execResult.durationMs);
  }

  if (ctx.globalOpts.raw) {
    writeRawOutput(content);
    return;
  }

  if (writePath) {
    outputWriteResult(ctx, writePath, allowAllPaths, skillName, content);
    return;
  }

  outputFormatted(ctx.globalOpts.output, "skill", skillName, content);
}

function resolveForcedAgent(
  ctx: CLIContext,
  router: ReturnType<typeof createRouter>["router"],
  agentName: string,
) {
  const agents = router.getAgents();
  const match = agents.find((a) => a.name === agentName);
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
  const structured = isStructuredOutput(ctx);
  const s = p.spinner();
  if (!structured) s.start("Routing to specialist agent...");
  const route = router.route(prompt, { projectDomains });
  if (!structured) {
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

  // Include file tree so LLM knows actual project structure
  const tree = buildFileTree(projectRoot);
  if (tree) contextParts.push(`\nProject files:\n${tree}`);

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
    const source = lastGen.skillName ?? lastGen.agentName ?? "unknown";
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
  opts: { skillName?: string; agentName?: string; filesWritten?: string[] },
): void {
  if (!projectRoot) return;
  saveLastGeneration(projectRoot, {
    timestamp: new Date().toISOString(),
    prompt,
    skillName: opts.skillName,
    agentName: opts.agentName,
    content,
    filesWritten: opts.filesWritten ?? [],
    contentHash: crypto.createHash("sha256").update(content).digest("hex"),
  });
}

export async function handleWriteOutput(
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
  // Strip code fences and LLM preamble before writing (all file types)
  let cleaned = stripCodeFences(content);
  // Additional script-specific cleaning (handles edge cases for .sh/.py/.ps1 etc.)
  cleaned = cleanScriptContent(cleaned, writePath);
  const action = writeFileContent(writePath, cleaned);
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ agent: agentName, content: cleaned, written: writePath, action }));
  } else if (action === "unchanged") {
    p.log.info(`${pc.dim("○")} ${pc.underline(writePath)} ${pc.dim("(unchanged)")}`);
  } else {
    const label = action === "created" ? pc.green("+ created") : pc.yellow("~ modified");
    p.log.success(`${label} ${pc.underline(writePath)}`);
  }

  // Script post-write handling: chmod, shebang check, validation
  if (action !== "unchanged") {
    runScriptPostWrite(writePath, cleaned);
  }
}

/**
 * Post-write handling for script files: set executable permissions,
 * check for missing shebang, and run available validators.
 */
function runScriptPostWrite(writePath: string, content: string): void {
  if (!isScriptFile(writePath)) return;

  // 1. chmod +x for shell scripts
  const madeExecutable = makeExecutable(writePath);
  if (madeExecutable) {
    p.log.info(`${pc.dim("chmod")} +x ${pc.underline(path.basename(writePath))}`);
  }

  // 2. Shebang verification
  const shebangWarning = checkShebang(content, writePath);
  if (shebangWarning) {
    p.log.warn(`${pc.yellow("\u26A0")} ${shebangWarning}`);
  }

  // 3. Post-generation validation (ShellCheck, py_compile)
  const validation = validateScript(writePath);
  if (validation) {
    if (!validation.available) {
      p.log.info(
        `${pc.dim("tip")} Install ${pc.bold(validation.tool)} for automatic script validation`,
      );
    } else if (validation.passed) {
      p.log.success(`${pc.green("\u2713")} ${validation.tool} passed`);
    } else {
      p.log.warn(`${pc.yellow("\u26A0")} ${validation.tool} found issues:`);
      for (const issue of validation.issues) {
        p.log.warn(`  ${pc.dim("\u2502")} ${issue}`);
      }
    }
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

function trySkillDirectPath(
  ctx: CLIContext,
  prompt: string,
  projectRoot: string | undefined,
  provider: ReturnType<CLIContext["getProvider"]>,
  docAugmenter: DocAugmenter | undefined,
  context7Provider: Context7Provider | undefined,
  projectContextStr: string | undefined,
): { skillName: string; skillCtx: SkillDirectContext; registryHasSkill: boolean } | null {
  // --skill flag is handled earlier in generateCommand(); here we only auto-detect
  const skillName = autoDetectSkill(prompt) ?? autoDetectInstalledSkill(prompt, projectRoot);
  if (!skillName) return null;

  const skillCtx = { provider, projectRoot, docAugmenter, context7Provider, projectContextStr };
  const registry = createSkillRegistry(provider, projectRoot, {
    docAugmenter,
    context7Provider,
    projectContext: projectContextStr,
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
  });
  return { skillName, skillCtx, registryHasSkill: !!registry.get(skillName) };
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
    agent_or_skill: agentName,
    metadata: "{}",
  });
}

/** Parse and validate the prompt from CLI args + optional file. */
function resolvePrompt(args: string[], ctx: CLIContext, writePath: string | undefined): string {
  const inlinePrompt = args.filter((a) => !a.startsWith("-") && a !== writePath).join(" ");
  let prompt = inlinePrompt;

  if (ctx.globalOpts.file) {
    try {
      const fileContent = readPromptFile(ctx.globalOpts.file);
      prompt = inlinePrompt ? `${inlinePrompt}\n\n${fileContent}` : fileContent;
      if (!isStructuredOutput(ctx)) {
        p.log.info(`Reading prompt from ${pc.underline(ctx.globalOpts.file)}`);
      }
    } catch (err) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
    }
  }

  if (!prompt) {
    p.log.info(`  ${pc.dim("$")} dojops generate <prompt>`);
    p.log.info(`  ${pc.dim("$")} dojops "your prompt here"`);
    p.log.info(`  ${pc.dim("$")} dojops -f task.md`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "No prompt provided.");
  }

  return prompt;
}

/** Handle the agent-routed generation result: persist, output, hooks. */
interface AgentResultOpts {
  prompt: string;
  projectRoot: string | undefined;
  writePath: string | undefined;
  allowAllPaths: boolean;
  genDuration: number;
}

/** Lightweight content quality gate for agent-generated output before writing to disk. */
function validateAgentOutput(content: string): string[] {
  const issues: string[] = [];
  const trimmed = content.trim();

  if (trimmed.length < 10) {
    issues.push("Output is too short (less than 10 characters) — likely incomplete.");
  }

  // Detect apology/refusal patterns that indicate the agent didn't produce real output
  const refusalPatterns = [
    /^I(?:'m| am) (?:sorry|unable|not able)/i,
    /^(?:Sorry|Unfortunately),? I (?:can(?:'t|not)|don't)/i,
    /^I (?:cannot|can't) (?:generate|create|produce|write)/i,
  ];
  for (const pattern of refusalPatterns) {
    if (pattern.test(trimmed)) {
      issues.push("Output appears to be a refusal rather than generated content.");
      break;
    }
  }

  return issues;
}

async function handleAgentResult(
  ctx: CLIContext,
  result: { content: string },
  route: { agent: { name: string } },
  opts: AgentResultOpts,
): Promise<void> {
  const { prompt, projectRoot, writePath, allowAllPaths, genDuration } = opts;

  // Validate agent output before writing
  if (writePath) {
    const issues = validateAgentOutput(result.content);
    if (issues.length > 0) {
      for (const issue of issues) {
        p.log.warn(`${pc.yellow("⚠")} Agent output: ${issue}`);
      }
    }
  }

  persistGeneration(projectRoot, prompt, result.content, {
    agentName: route.agent.name,
    filesWritten: writePath ? [writePath] : [],
  });

  if (projectRoot) {
    trackAgentActivity(projectRoot, prompt, route.agent.name, writePath, genDuration);
  }

  // stream-json output was already emitted during streaming — just run hooks
  if (ctx.globalOpts.output === "stream-json") {
    if (projectRoot) {
      runHooks(
        projectRoot,
        "post-generate",
        { prompt, agent: route.agent.name, outputPath: writePath },
        { verbose: ctx.globalOpts.verbose },
      );
    }
    return;
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

type GenerationResult = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

function emitStreamInitAndResult(
  ctx: CLIContext,
  agentName: string,
  result: GenerationResult,
  genDuration: number,
): void {
  emitStreamEvent({
    type: "result",
    content: result.content,
    stats: {
      agent: agentName,
      durationMs: genDuration,
      ...(result.usage ?? {}),
    },
  });
}

async function runGeneration(
  ctx: CLIContext,
  route: ReturnType<typeof resolveRoute>,
  augmentedPrompt: string,
  structured: boolean,
): Promise<{ result: GenerationResult; genDuration: number }> {
  const isStreamJson = ctx.globalOpts.output === "stream-json";
  const canStream = (!structured || isStreamJson) && route.agent.supportsStreaming;

  if (isStreamJson) {
    const providerName = ctx.globalOpts.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
    const modelName = ctx.globalOpts.model ?? process.env.DOJOPS_MODEL ?? "(default)";
    emitStreamEvent({
      type: "init",
      provider: providerName,
      model: modelName,
      timestamp: new Date().toISOString(),
    });
  }

  if (isStreamJson && canStream) {
    const genStart = Date.now();
    const result = await route.agent.streamWithHistory(
      [{ role: "user", content: sanitizeUserInput(augmentedPrompt) }],
      (chunk) => emitStreamEvent({ type: "chunk", content: chunk }),
    );
    const genDuration = Date.now() - genStart;
    emitStreamInitAndResult(ctx, route.agent.name, result, genDuration);
    return { result, genDuration };
  }

  if (canStream) {
    const { createStreamRenderer } = await import("../tui/stream-renderer");
    const renderer = createStreamRenderer({ quiet: ctx.globalOpts.quiet });
    renderer.showPhase(`${route.agent.name} generating...`);
    const genStart = Date.now();
    const result = await route.agent.streamWithHistory(
      [{ role: "user", content: sanitizeUserInput(augmentedPrompt) }],
      (chunk) => renderer.writeChunk(chunk),
    );
    const genDuration = Date.now() - genStart;
    renderer.finalize();
    return { result, genDuration };
  }

  if (isStreamJson) {
    const genStart = Date.now();
    const result = await route.agent.run({ prompt: sanitizeUserInput(augmentedPrompt) });
    const genDuration = Date.now() - genStart;
    emitStreamInitAndResult(ctx, route.agent.name, result, genDuration);
    return { result, genDuration };
  }

  const s2 = p.spinner();
  if (!structured) s2.start("Thinking...");
  const genStart = Date.now();
  const result = await route.agent.run({ prompt: sanitizeUserInput(augmentedPrompt) });
  const genDuration = Date.now() - genStart;
  if (!structured) s2.stop("Done.");
  return { result, genDuration };
}

async function applyModelRouting(ctx: CLIContext, prompt: string): Promise<void> {
  if (ctx.globalOpts.model) return;
  const { loadConfig, resolveProvider } = await import("../config");
  const config = loadConfig();
  if (!config.modelRouting?.enabled) return;
  const { resolveModelForPrompt, isModelCompatibleWithProvider } = await import("@dojops/core");
  const override = resolveModelForPrompt(prompt, config.modelRouting);
  if (!override) return;

  // Enforce provider isolation: reject models that belong to a different provider
  const activeProvider = resolveProvider(ctx.globalOpts.provider, config);
  if (!isModelCompatibleWithProvider(override.model, activeProvider)) {
    p.log.warn(
      pc.yellow(
        `Model routing skipped: "${override.model}" is not compatible with provider "${activeProvider}". ` +
          `Routing rules must use models from the configured provider.`,
      ),
    );
    return;
  }

  ctx.globalOpts.model = override.model;
  if (ctx.globalOpts.verbose) {
    p.log.info(pc.dim(`Model routing: ${override.reason} → ${override.model}`));
  }
}

export async function generateCommand(args: string[], ctx: CLIContext): Promise<void> {
  const writePath = extractFlagValue(args, "--write");
  const allowAllPaths = hasFlag(args, "--allow-all-paths");
  const prompt = resolvePrompt(args, ctx, writePath);

  const projectRoot = findProjectRoot() ?? undefined;
  runPreGenerateHook(projectRoot, prompt, ctx.globalOpts.verbose);

  await applyModelRouting(ctx, prompt);

  const provider = ctx.getProvider();
  const { docAugmenter, context7Provider } = await initContext7();
  const projectContextStr = buildProjectContextString(projectRoot);

  // Explicit --skill flag: user override takes top priority (unchanged)
  if (ctx.globalOpts.skill) {
    const skillCtx = { provider, projectRoot, docAugmenter, context7Provider, projectContextStr };
    await handleSkillDirect(
      ctx,
      args,
      prompt,
      writePath,
      allowAllPaths,
      ctx.globalOpts.skill,
      skillCtx,
    );
    return;
  }

  // Agent-first routing: let agents decide before falling back to skill auto-detection.
  // Agents are domain specialists with project context awareness; skills are template
  // generators. Routing to agents first gives them authority over their domain while
  // skills remain available as tools (via run_skill) and as fallback.
  const { router } = createRouter(provider, projectRoot, docAugmenter);
  const projectDomains: string[] = projectRoot
    ? (freshContext(projectRoot)?.relevantDomains ?? [])
    : [];

  const route = resolveRoute(ctx, router, prompt, projectDomains);

  // High-confidence agent match (>= 0.4 = router threshold) → agent handles
  if (route.confidence >= 0.4) {
    await runAgentPath(ctx, args, route, prompt, projectRoot, writePath, allowAllPaths);
    return;
  }

  // Low agent confidence → fall back to skill auto-detection for generation tasks
  const skillDirect = trySkillDirectPath(
    ctx,
    prompt,
    projectRoot,
    provider,
    docAugmenter,
    context7Provider,
    projectContextStr,
  );
  if (skillDirect?.registryHasSkill) {
    await handleSkillDirect(
      ctx,
      args,
      prompt,
      writePath,
      allowAllPaths,
      skillDirect.skillName,
      skillDirect.skillCtx,
    );
    return;
  }

  // No skill match either — try hub search fallback
  const fallbackResult = await trySkillFallback(
    ctx,
    prompt,
    writePath,
    allowAllPaths,
    projectRoot,
    provider,
    docAugmenter,
    context7Provider,
    projectContextStr,
  );
  if (fallbackResult === "handled") return;

  if (fallbackResult === "retry") {
    const retrySkill = trySkillDirectPath(
      ctx,
      prompt,
      projectRoot,
      provider,
      docAugmenter,
      context7Provider,
      projectContextStr,
    );
    if (retrySkill?.registryHasSkill) {
      await handleSkillDirect(
        ctx,
        args,
        prompt,
        writePath,
        allowAllPaths,
        retrySkill.skillName,
        retrySkill.skillCtx,
      );
      return;
    }
  }

  // Final fallback: agent handles with default/low confidence
  await runAgentPath(ctx, args, route, prompt, projectRoot, writePath, allowAllPaths);
}

/** Run the agent routing path: preflight check, generation, result handling. */
async function runAgentPath(
  ctx: CLIContext,
  args: string[],
  route: ReturnType<typeof resolveRoute>,
  prompt: string,
  projectRoot: string | undefined,
  writePath: string | undefined,
  allowAllPaths: boolean,
): Promise<void> {
  const canProceed = preflightCheck(route.agent.name, route.agent.toolDependencies, {
    quiet: ctx.globalOpts.quiet || ctx.globalOpts.output === "json",
  });
  if (!canProceed) {
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }

  const augmentedPrompt = buildAugmentedPrompt(prompt, projectRoot, ctx.globalOpts.verbose);
  const structured = isStructuredOutput(ctx);
  const { result, genDuration } = await runGeneration(ctx, route, augmentedPrompt, structured);

  if (ctx.globalOpts.verbose) {
    p.log.info(`Generation completed in ${genDuration}ms (${result.content.length} chars)`);
  }

  await handleAgentResult(ctx, result, route, {
    prompt,
    projectRoot,
    writePath,
    allowAllPaths,
    genDuration,
  });
}
