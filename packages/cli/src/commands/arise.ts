import pc from "picocolors";
import * as p from "@clack/prompts";
import { scanRepo, RepoContext, initHookEngine } from "@dojops/core";
import { createSkillRegistry } from "@dojops/skill-registry";
import { PlannerExecutor, TaskGraph, TaskNode } from "@dojops/planner";
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";
import { buildFileTree } from "@dojops/session";
import { CLIContext } from "../types";
import { hasFlag } from "../parser";
import { wrapForNote, truncateNoteTitle } from "../formatter";
import {
  findProjectRoot,
  initProject,
  savePlan,
  appendAudit,
  getCurrentUser,
  getDojopsVersion,
  generatePlanId,
  PlanState,
} from "../state";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { cliApprovalHandler } from "../approval";
import { createProgressReporter } from "../progress";
import { createAutoInstallHandler } from "../toolchain-sandbox";
import { classifyPlanRisk } from "../risk-classifier";
import { formatScanSummary } from "./init";
import { renderPipelineDiagram, listPlannedFiles } from "./arise-diagram";
import {
  type CIPlatform,
  type PipelineStage,
  type PipelinePreferences,
  type ContainerRegistry,
  type SecurityScanner,
  type DeployTarget,
  type EnvStrategy,
  type NotificationTarget,
  SKILL_MAP,
} from "./arise-types";

// ── Internal types ───────────────────────────────────────────────────

interface AriseFlags {
  autoApprove: boolean;
  dryRun: boolean;
  skipVerify: boolean;
  jsonOutput: boolean;
}

interface VerifyEntry {
  id: string;
  passed: boolean;
  issues: number;
  errors: string[];
}

// ── Phase helpers for ariseCommand ───────────────────────────────────

function parseAriseFlags(args: string[], ctx: CLIContext): AriseFlags {
  return {
    autoApprove: hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive,
    dryRun: hasFlag(args, "--dry-run") || ctx.globalOpts.dryRun,
    skipVerify: hasFlag(args, "--skip-verify"),
    jsonOutput: ctx.globalOpts.output === "json",
  };
}

function scanRepository(root: string): RepoContext {
  const s = p.spinner();
  s.start("Scanning repository...");
  try {
    const repoCtx = scanRepo(root);
    s.stop("Repository scanned.");
    return repoCtx;
  } catch (err) {
    s.stop("Scan failed.");
    throw new CLIError(ExitCode.GENERAL_ERROR, `Repository scan failed: ${toErrorMessage(err)}`);
  }
}

function showPipelinePreview(prefs: PipelinePreferences, repoCtx: RepoContext): void {
  const diagram = renderPipelineDiagram(prefs, repoCtx);
  p.note(wrapForNote(diagram), "Pipeline design");

  const plannedFiles = listPlannedFiles(prefs);
  const fileList = plannedFiles.map((f) => `  ${pc.cyan("+")} ${f}`).join("\n");
  p.note(wrapForNote(fileList), `Files to generate (${plannedFiles.length})`);
}

function createPlannerExecutor(
  tools: ReturnType<ReturnType<typeof createSkillRegistry>["getAll"]>,
  root: string,
  jsonOutput: boolean,
  taskCount: number,
): {
  executor: PlannerExecutor;
  progress: ReturnType<typeof createProgressReporter> | null;
} {
  const progress = jsonOutput ? null : createProgressReporter(taskCount);
  const ariseHookEngine = initHookEngine(root);

  const executor = new PlannerExecutor(
    tools,
    {
      taskStart(id, desc) {
        ariseHookEngine.emit("TaskStart", { taskId: id, description: desc }).catch(() => {});
        if (progress) {
          progress.start(id, desc);
        } else {
          p.log.step(`Running ${pc.blue(id)}: ${desc}`);
        }
      },
      taskEnd(id, _status, error) {
        ariseHookEngine
          .emit("TaskComplete", { taskId: id, status: _status, error })
          .catch(() => {});
        if (progress && error) {
          progress.fail(id, error);
        } else if (progress) {
          progress.complete(id);
        } else if (error) {
          p.log.error(`${pc.blue(id)}: failed - ${pc.red(error)}`);
        } else {
          p.log.info(`${pc.blue(id)}: generated`);
        }
      },
    },
    { generateTimeoutMs: 120_000 },
  );

  return { executor, progress };
}

async function createSafeExecutorInstance(
  provider: ReturnType<CLIContext["getProvider"]>,
  root: string,
  flags: AriseFlags,
): Promise<SafeExecutor> {
  let critic: import("@dojops/executor").CriticCallback | undefined;
  try {
    const { CriticAgent } = await import("@dojops/core");
    critic = new CriticAgent(provider);
  } catch {
    // CriticAgent not available
  }

  const hookEngine = initHookEngine(root);

  return new SafeExecutor({
    policy: {
      allowWrite: true,
      requireApproval: !flags.autoApprove,
      approvalMode: flags.autoApprove ? "never" : "risk-based",
      autoApproveRiskLevel: "MEDIUM",
      timeoutMs: 120_000,
      executeTimeoutMs: 10 * 60_000,
      skipVerification: flags.skipVerify,
      enforceDevOpsAllowlist: true,
      maxRepairAttempts: 3,
    },
    approvalHandler: flags.autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    critic,
    hookEngine,
    progress: flags.jsonOutput
      ? undefined
      : {
          onVerificationFailed(taskId, errors) {
            p.log.warn(
              `Verification failed for ${pc.bold(taskId)} (${errors.length} error${errors.length === 1 ? "" : "s"}). Starting self-repair...`,
            );
          },
          onRepairAttempt(taskId, attempt, maxAttempts) {
            p.log.info(
              `${pc.yellow("↻")} Repairing ${pc.bold(taskId)} (attempt ${attempt}/${maxAttempts})`,
            );
          },
          onVerificationPassed(taskId) {
            p.log.success(`Self-repair succeeded for ${pc.bold(taskId)}`);
          },
        },
  });
}

async function validateAndWriteResults(
  planResult: Awaited<ReturnType<PlannerExecutor["execute"]>>,
  graph: TaskGraph,
  toolMap: Map<string, ReturnType<ReturnType<typeof createSkillRegistry>["getAll"]>[number]>,
  safeExecutor: SafeExecutor,
): Promise<{ allFilesCreated: string[]; verifyResults: VerifyEntry[] }> {
  const allFilesCreated: string[] = [];
  const verifyResults: VerifyEntry[] = [];

  for (const result of planResult.results) {
    if (result.status !== "completed" || !result.output) {
      const reason = result.error ?? "generation failed (no output)";
      verifyResults.push({ id: result.taskId, passed: false, issues: 1, errors: [reason] });
      continue;
    }

    const taskNode = graph.tasks.find((t) => t.id === result.taskId);
    const tool = toolMap.get(taskNode?.tool ?? "");
    if (!tool) continue;

    const input = taskNode?.input ?? { prompt: taskNode?.description ?? "" };
    const preGenerated = { success: true as const, data: result.output };

    try {
      const execResult = await safeExecutor.executeTask(
        result.taskId,
        tool,
        input,
        undefined,
        preGenerated,
      );
      const files = execResult.auditLog?.filesWritten ?? [];
      allFilesCreated.push(...files);

      const passed = execResult.status === "completed";
      const issueList = execResult.verification?.issues ?? [];
      const errorMsgs = issueList.map((i) => i.message);
      verifyResults.push({
        id: result.taskId,
        passed,
        issues: issueList.length,
        errors: errorMsgs,
      });
    } catch (err) {
      verifyResults.push({
        id: result.taskId,
        passed: false,
        issues: 1,
        errors: [toErrorMessage(err)],
      });
      p.log.warn(`${pc.bold(result.taskId)}: ${toErrorMessage(err)}`);
    }
  }

  return { allFilesCreated, verifyResults };
}

function formatVerifyLine(r: VerifyEntry): string[] {
  const icon = r.passed ? pc.green("✓") : pc.red("✗");
  const issueSuffix = r.issues === 1 ? "" : "s";
  const issueHint = r.issues > 0 ? pc.dim(` (${r.issues} issue${issueSuffix})`) : "";
  const lines = [`  ${icon} ${r.id}${issueHint}`];

  if (!r.passed && r.errors.length > 0) {
    for (const msg of r.errors.slice(0, 5)) {
      lines.push(`    ${pc.dim("- " + msg)}`);
    }
    if (r.errors.length > 5) {
      const moreCount = r.errors.length - 5;
      const moreText = `... and ${moreCount} more`;
      lines.push(`    ${pc.dim(moreText)}`);
    }
  }
  return lines;
}

function showSummary(verifyResults: VerifyEntry[], allFilesCreated: string[]): void {
  const verifyLines = verifyResults.flatMap(formatVerifyLine);
  p.note(wrapForNote(verifyLines.join("\n")), "Verification");

  if (allFilesCreated.length > 0) {
    const fileLines = allFilesCreated.map((f) => `  ${pc.green("+")} ${f}`).join("\n");
    p.note(wrapForNote(fileLines), `Files created (${allFilesCreated.length})`);
  }
}

function persistAuditAndPlan(
  root: string,
  prefs: PipelinePreferences,
  graph: TaskGraph,
  planResult: Awaited<ReturnType<PlannerExecutor["execute"]>>,
  allFilesCreated: string[],
  elapsed: number,
  ctx: CLIContext,
): void {
  try {
    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      command: "arise",
      action: `arise: ${prefs.stages.join(", ")}`,
      status: planResult.success ? "success" : "failure",
      durationMs: elapsed,
    });
  } catch {
    // Audit write failure is non-fatal
  }

  try {
    const planId = generatePlanId();
    const planState: PlanState = {
      id: planId,
      goal: `arise: ${prefs.stages.join(", ")}`,
      createdAt: new Date().toISOString(),
      risk: classifyPlanRisk(graph.tasks),
      tasks: graph.tasks.map((t) => ({
        id: t.id,
        tool: t.tool,
        description: t.description,
        dependsOn: t.dependsOn,
        input: t.input ?? {},
      })),
      files: allFilesCreated,
      approvalStatus: planResult.success ? "APPLIED" : "PARTIAL",
      executionContext: {
        provider: ctx.globalOpts.provider ?? "unknown",
        model: ctx.globalOpts.model,
        dojopsVersion: getDojopsVersion(),
      },
    };
    savePlan(root, planState);
  } catch {
    // Plan save failure is non-fatal
  }
}

// ── Command handler ──────────────────────────────────────────────────

export const ariseCommand = async (args: string[], ctx: CLIContext): Promise<void> => {
  const flags = parseAriseFlags(args, ctx);

  p.intro(pc.cyan(pc.bold("dojops arise")));

  // Phase 1: Analyze codebase
  const cwd = process.cwd();
  let root = findProjectRoot(cwd);
  if (!root) {
    initProject(cwd);
    root = cwd;
  }

  const repoCtx = scanRepository(root);
  p.note(wrapForNote(formatScanSummary(repoCtx).join("\n")), "Repo analysis");

  // Phase 2: Gather preferences
  const prefs = flags.autoApprove ? buildSmartDefaults(repoCtx) : await gatherPreferences(repoCtx);
  if (!prefs) return;

  // Phase 3: Preview and confirm
  showPipelinePreview(prefs, repoCtx);

  if (flags.dryRun) {
    p.outro(pc.dim("Dry run complete. No files were generated."));
    return;
  }

  if (!flags.autoApprove) {
    const confirmed = await p.confirm({ message: "Generate this pipeline?" });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      return;
    }
  }

  // Phase 4: Generate artifacts
  const provider = ctx.getProvider();
  const projectContext = buildFileTree(root);
  const registry = createSkillRegistry(provider, root, {
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
    projectContext: projectContext || undefined,
  });
  const tools = registry.getAll();
  const graph = buildAriseTaskGraph(prefs, repoCtx);

  const taskLines = graph.tasks.map((task) => {
    const deps = task.dependsOn.length ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    return `  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`;
  });
  p.note(wrapForNote(taskLines.join("\n")), truncateNoteTitle(`Tasks (${graph.tasks.length})`));

  const startTime = Date.now();
  const { executor, progress } = createPlannerExecutor(
    tools,
    root,
    flags.jsonOutput,
    graph.tasks.length,
  );
  const planResult = await executor.execute(graph);
  progress?.done();

  // Phase 5: Validate and write files
  const safeExecutor = await createSafeExecutorInstance(provider, root, flags);
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const { allFilesCreated, verifyResults } = await validateAndWriteResults(
    planResult,
    graph,
    toolMap,
    safeExecutor,
  );

  // Phase 6: Summary
  const elapsed = Date.now() - startTime;
  showSummary(verifyResults, allFilesCreated);
  persistAuditAndPlan(root, prefs, graph, planResult, allFilesCreated, elapsed, ctx);

  const successCount = verifyResults.filter((r) => r.passed).length;
  const totalCount = verifyResults.length;
  const color = successCount === totalCount ? pc.green : pc.yellow;
  p.outro(
    color(
      `Pipeline generated: ${successCount}/${totalCount} tasks succeeded in ${fmtDuration(elapsed)}`,
    ),
  );
};

// ── Smart defaults helpers ──────────────────────────────────────────

const VALID_CI_PLATFORMS = new Set<CIPlatform>(["github-actions", "gitlab-ci", "jenkinsfile"]);

function detectCIPlatform(ctx: RepoContext): CIPlatform {
  if (ctx.ci.length === 0) return "github-actions";
  const detected = ctx.ci[0].platform;
  return VALID_CI_PLATFORMS.has(detected as CIPlatform)
    ? (detected as CIPlatform)
    : "github-actions";
}

function detectStages(ctx: RepoContext): PipelineStage[] {
  const stages: PipelineStage[] = ["build", "test", "lint"];

  const hasContainer = ctx.container.hasDockerfile || ctx.container.hasCompose;
  if (hasContainer) stages.push("containerize");

  const hasDependencyScanning = ctx.security?.hasDependabot || ctx.security?.hasRenovate;
  if (hasDependencyScanning) stages.push("security-scan");

  const hasInfra =
    ctx.infra.hasKubernetes ||
    ctx.infra.hasHelm ||
    ctx.infra.hasTerraform ||
    ctx.container.hasCompose;
  if (hasInfra) stages.push("deploy");

  return stages;
}

function detectContainerRegistry(
  stages: PipelineStage[],
  ciPlatform: CIPlatform,
): ContainerRegistry | undefined {
  if (!stages.includes("containerize")) return undefined;
  return ciPlatform === "github-actions" ? "ghcr" : "dockerhub";
}

function detectDeployTarget(stages: PipelineStage[], ctx: RepoContext): DeployTarget | undefined {
  if (!stages.includes("deploy")) return undefined;
  if (ctx.infra.hasHelm) return "helm";
  if (ctx.infra.hasKubernetes) return "kubernetes";
  if (ctx.container.hasCompose) return "docker-compose";
  return "kubernetes";
}

function buildSmartDefaults(ctx: RepoContext): PipelinePreferences {
  const ciPlatform = detectCIPlatform(ctx);
  const stages = detectStages(ctx);
  const containerRegistry = detectContainerRegistry(stages, ciPlatform);
  const deployTarget = detectDeployTarget(stages, ctx);

  return {
    ciPlatform,
    stages,
    containerRegistry,
    securityScanner: stages.includes("security-scan") ? "trivy" : undefined,
    deployTarget,
    envStrategy: "staging-prod",
    notifications: "none",
  };
}

// ── Interactive preference gathering ─────────────────────────────────

/**
 * Wraps a @clack/prompts call: returns the value on success, or null if cancelled.
 * Eliminates the repeated isCancel + p.cancel pattern from each prompt step.
 */
async function promptOrCancel<T>(promptFn: () => Promise<T | symbol>): Promise<T | null> {
  const result = await promptFn();
  if (p.isCancel(result)) {
    p.cancel("Cancelled.");
    return null;
  }
  return result as T;
}

function buildCIOptions(
  detectedCI: string | null,
): { value: CIPlatform; label: string; hint?: string }[] {
  return [
    {
      value: "github-actions" as CIPlatform,
      label: "GitHub Actions",
      hint: detectedCI === "github-actions" ? "detected" : undefined,
    },
    {
      value: "gitlab-ci" as CIPlatform,
      label: "GitLab CI",
      hint: detectedCI === "gitlab-ci" ? "detected" : undefined,
    },
    {
      value: "jenkinsfile" as CIPlatform,
      label: "Jenkins",
      hint: detectedCI === "jenkinsfile" ? "detected" : undefined,
    },
  ];
}

function buildDeployOptions(
  ctx: RepoContext,
): { value: DeployTarget; label: string; hint?: string }[] {
  return [
    {
      value: "kubernetes" as DeployTarget,
      label: "Kubernetes (raw manifests)",
      hint: ctx.infra.hasKubernetes ? "detected" : undefined,
    },
    {
      value: "helm" as DeployTarget,
      label: "Helm chart",
      hint: ctx.infra.hasHelm ? "detected" : undefined,
    },
    {
      value: "docker-compose" as DeployTarget,
      label: "Docker Compose",
      hint: ctx.container.hasCompose ? "detected" : undefined,
    },
    { value: "argocd" as DeployTarget, label: "ArgoCD (GitOps)" },
    { value: "ecs" as DeployTarget, label: "AWS ECS" },
    { value: "bare-metal" as DeployTarget, label: "Bare metal (SSH)" },
    { value: "serverless" as DeployTarget, label: "Serverless (Lambda/Cloud Functions)" },
  ];
}

async function gatherPreferences(ctx: RepoContext): Promise<PipelinePreferences | null> {
  const defaults = buildSmartDefaults(ctx);
  const detectedCI = ctx.ci.length > 0 ? ctx.ci[0].platform : null;

  // 1. CI platform
  const ciChoice = await promptOrCancel<CIPlatform>(() =>
    p.select({
      message: "CI/CD platform:",
      options: buildCIOptions(detectedCI),
      initialValue: defaults.ciPlatform,
    }),
  );
  if (ciChoice === null) return null;

  // 2. Pipeline stages
  const stageChoice = await promptOrCancel<PipelineStage[]>(() =>
    p.multiselect({
      message: "Pipeline stages:",
      options: [
        { value: "build" as PipelineStage, label: "Build", hint: "compile/bundle" },
        { value: "test" as PipelineStage, label: "Test", hint: "unit + integration tests" },
        { value: "lint" as PipelineStage, label: "Lint", hint: "code quality" },
        {
          value: "security-scan" as PipelineStage,
          label: "Security scan",
          hint: "vulnerability scanning",
        },
        {
          value: "containerize" as PipelineStage,
          label: "Containerize",
          hint: ctx.container.hasDockerfile ? "Dockerfile detected" : "generate Dockerfile",
        },
        {
          value: "publish-artifacts" as PipelineStage,
          label: "Publish artifacts",
          hint: "push to registry",
        },
        { value: "deploy" as PipelineStage, label: "Deploy", hint: "ship to target environment" },
      ],
      initialValues: defaults.stages,
      required: true,
    }),
  );
  if (stageChoice === null) return null;
  const stages = stageChoice;

  // 3. Container registry (conditional)
  let containerRegistry: ContainerRegistry | undefined;
  if (stages.includes("containerize") || stages.includes("publish-artifacts")) {
    const registryChoice = await promptOrCancel<ContainerRegistry>(() =>
      p.select({
        message: "Container registry:",
        options: [
          { value: "ghcr" as ContainerRegistry, label: "GitHub Container Registry (ghcr.io)" },
          { value: "dockerhub" as ContainerRegistry, label: "Docker Hub" },
          { value: "ecr" as ContainerRegistry, label: "AWS ECR" },
          { value: "gcr" as ContainerRegistry, label: "Google Container Registry" },
          { value: "jfrog" as ContainerRegistry, label: "JFrog Artifactory" },
          { value: "nexus" as ContainerRegistry, label: "Sonatype Nexus" },
        ],
        initialValue: defaults.containerRegistry ?? ("ghcr" as ContainerRegistry),
      }),
    );
    if (registryChoice === null) return null;
    containerRegistry = registryChoice;
  }

  // 4. Security scanner (conditional)
  let securityScanner: SecurityScanner | undefined;
  if (stages.includes("security-scan")) {
    const scannerChoice = await promptOrCancel<SecurityScanner>(() =>
      p.select({
        message: "Security scanner:",
        options: [
          { value: "trivy" as SecurityScanner, label: "Trivy (open-source, recommended)" },
          { value: "snyk" as SecurityScanner, label: "Snyk" },
          { value: "grype" as SecurityScanner, label: "Grype (Anchore)" },
          { value: "falco" as SecurityScanner, label: "Falco (runtime security)" },
        ],
        initialValue: "trivy" as SecurityScanner,
      }),
    );
    if (scannerChoice === null) return null;
    securityScanner = scannerChoice;
  }

  // 5. Deploy target (conditional)
  let deployTarget: DeployTarget | undefined;
  if (stages.includes("deploy")) {
    const deployChoice = await promptOrCancel<DeployTarget>(() =>
      p.select({
        message: "Deployment target:",
        options: buildDeployOptions(ctx),
        initialValue: defaults.deployTarget ?? "kubernetes",
      }),
    );
    if (deployChoice === null) return null;
    deployTarget = deployChoice;
  }

  // 6. Environment strategy
  const envChoice = await promptOrCancel<EnvStrategy>(() =>
    p.select({
      message: "Environment strategy:",
      options: [
        { value: "single" as EnvStrategy, label: "Single environment" },
        { value: "staging-prod" as EnvStrategy, label: "Staging + Production" },
        { value: "dev-staging-prod" as EnvStrategy, label: "Dev + Staging + Production" },
      ],
      initialValue: "staging-prod" as EnvStrategy,
    }),
  );
  if (envChoice === null) return null;

  // 7. Notifications
  const notifChoice = await promptOrCancel<NotificationTarget>(() =>
    p.select({
      message: "Notifications:",
      options: [
        { value: "none" as NotificationTarget, label: "None" },
        { value: "slack" as NotificationTarget, label: "Slack" },
        { value: "email" as NotificationTarget, label: "Email" },
      ],
      initialValue: "none" as NotificationTarget,
    }),
  );
  if (notifChoice === null) return null;

  return {
    ciPlatform: ciChoice,
    stages,
    containerRegistry,
    securityScanner,
    deployTarget,
    envStrategy: envChoice,
    notifications: notifChoice,
  };
}

// ── TaskGraph construction helpers ──────────────────────────────────

const ENV_LABELS: Record<EnvStrategy, string> = {
  single: "single environment",
  "staging-prod": "staging and production environments",
  "dev-staging-prod": "dev, staging, and production environments",
};

interface ProjectLabels {
  lang: string | null;
  pkgMgr: string | null;
  projectLabel: string;
  pkgMgrClause: string;
  envLabel: string;
}

function buildProjectLabels(prefs: PipelinePreferences, ctx: RepoContext): ProjectLabels {
  const lang = ctx.primaryLanguage;
  const pkgMgr = ctx.packageManager?.name ?? null;
  return {
    lang,
    pkgMgr,
    projectLabel: lang ? `a ${lang} project` : "this project",
    pkgMgrClause: pkgMgr ? ` using ${pkgMgr}` : " (detect the toolchain from the repo contents)",
    envLabel: ENV_LABELS[prefs.envStrategy],
  };
}

function buildToolchainHint(pkgMgr: string | null): string {
  return pkgMgr
    ? `Use the ${pkgMgr} toolchain for install/build/test steps — do not invoke make unless a Makefile is actually present.`
    : "Do not invoke make unless a Makefile is actually present; otherwise use the native toolchain of the detected language.";
}

function buildCIWorkflowTask(
  prefs: PipelinePreferences,
  ctx: RepoContext,
  labels: ProjectLabels,
): TaskNode {
  const stageList = prefs.stages.join(", ");
  const ciPrompt = [
    `Generate a ${prefs.ciPlatform} CI/CD pipeline for ${labels.projectLabel}${labels.pkgMgrClause}.`,
    `Include these stages: ${stageList}.`,
    prefs.stages.includes("test") ? "Run tests in the pipeline." : "",
    prefs.stages.includes("lint") ? "Run linting in the pipeline." : "",
    prefs.stages.includes("security-scan")
      ? `Add ${prefs.securityScanner ?? "trivy"} security scanning.`
      : "",
    prefs.stages.includes("containerize")
      ? `Build Docker image and push to ${prefs.containerRegistry ?? "ghcr"}.`
      : "",
    prefs.stages.includes("deploy")
      ? `Deploy to ${prefs.deployTarget ?? "kubernetes"} with ${labels.envLabel}.`
      : "",
    prefs.notifications === "none" ? "" : `Send ${prefs.notifications} notifications on failure.`,
    ctx.meta.isMonorepo ? "This is a monorepo; set up matrix or per-package jobs." : "",
    buildToolchainHint(labels.pkgMgr),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: "ci-workflow",
    tool: SKILL_MAP[prefs.ciPlatform] ?? "github-actions",
    description: ciPrompt,
    dependsOn: [],
    input: { prompt: ciPrompt },
  };
}

function buildDockerfileTask(labels: ProjectLabels): TaskNode {
  const dockerPrompt = [
    `Generate a production Dockerfile for ${labels.projectLabel}${labels.pkgMgrClause}.`,
    "Requirements:",
    "- Multi-stage build (separate build stage from runtime stage).",
    "- Pin base images to specific versions (no `:latest`).",
    "- Run as a non-root user in the final stage.",
    "- Minimal final image (distroless, alpine, or slim where appropriate).",
    "- Use BuildKit cache mounts for dependency installation when the syntax is supported.",
    "- Set a HEALTHCHECK when the app exposes a port.",
    labels.pkgMgr
      ? `- Install dependencies with ${labels.pkgMgr}; do NOT invoke make unless a Makefile is present.`
      : "- Do NOT invoke make unless a Makefile is present; use the native toolchain of the detected language.",
    "",
    "Inline comments (REQUIRED):",
    "- Prefix every stage with a comment block explaining that stage’s role.",
    "- Add a short comment above each non-trivial RUN, COPY, ENV, and USER instruction explaining why it is there.",
    "- Note any caching or layer-ordering decisions (e.g., why deps are copied before source).",
    "- Comments must be accurate — no generic filler like `# install dependencies` when the line does more than that.",
    "",
    "Also output a matching .dockerignore that excludes build artefacts, node_modules / target / dist / .venv, local env files, and VCS metadata.",
  ].join("\n");

  return {
    id: "dockerfile",
    tool: "dockerfile",
    description: dockerPrompt,
    dependsOn: [],
    input: { prompt: dockerPrompt },
  };
}

function buildDeployTask(
  prefs: PipelinePreferences,
  ctx: RepoContext,
  envLabel: string,
): TaskNode | null {
  if (!prefs.deployTarget) return null;

  const deps = prefs.stages.includes("containerize") ? ["dockerfile"] : [];
  const deployPrompt = buildDeployPrompt(prefs, ctx, envLabel);
  const deploySkill = resolveDeploySkill(prefs.deployTarget);

  return {
    id: "deploy-config",
    tool: deploySkill,
    description: deployPrompt,
    dependsOn: deps,
    input: { prompt: deployPrompt },
  };
}

function buildSecurityTasks(prefs: PipelinePreferences): TaskNode[] {
  const tasks: TaskNode[] = [];

  const isTrivyWithK8s =
    prefs.securityScanner === "trivy" &&
    (prefs.deployTarget === "kubernetes" || prefs.deployTarget === "helm");

  if (isTrivyWithK8s) {
    tasks.push({
      id: "trivy-operator",
      tool: "trivy-operator",
      description:
        "Generate Trivy Operator installation manifest for in-cluster vulnerability scanning.",
      dependsOn: [],
      input: {
        prompt:
          "Generate Trivy Operator installation manifest for in-cluster vulnerability scanning.",
      },
    });
  }

  if (prefs.securityScanner === "falco") {
    tasks.push({
      id: "falco-rules",
      tool: "falco",
      description: "Generate Falco runtime security rules for container workloads.",
      dependsOn: [],
      input: {
        prompt: "Generate Falco runtime security rules for container workloads.",
      },
    });
  }

  return tasks;
}

// ── TaskGraph construction ───────────────────────────────────────────

function buildAriseTaskGraph(prefs: PipelinePreferences, ctx: RepoContext): TaskGraph {
  const labels = buildProjectLabels(prefs, ctx);
  const tasks: TaskNode[] = [];

  // Always: the CI workflow
  tasks.push(buildCIWorkflowTask(prefs, ctx, labels));

  // Dockerfile (parallel with CI)
  if (prefs.stages.includes("containerize")) {
    tasks.push(buildDockerfileTask(labels));
  }

  // Deploy config (depends on dockerfile if containerize is selected)
  if (prefs.stages.includes("deploy")) {
    const deployTask = buildDeployTask(prefs, ctx, labels.envLabel);
    if (deployTask) tasks.push(deployTask);
  }

  // Security tasks (parallel)
  if (prefs.stages.includes("security-scan")) {
    tasks.push(...buildSecurityTasks(prefs));
  }

  const stageList = prefs.stages.join(", ");
  return {
    goal: `Generate CI/CD pipeline: ${stageList}`,
    tasks,
  };
}

function buildDeployPrompt(prefs: PipelinePreferences, ctx: RepoContext, envLabel: string): string {
  const lang = ctx.primaryLanguage ?? "the project";
  const base = `Generate deployment configuration for a ${lang} project targeting ${prefs.deployTarget}.`;
  const env = `Support ${envLabel}.`;
  const registry = prefs.containerRegistry
    ? `Container images are hosted on ${prefs.containerRegistry}.`
    : "";
  return [base, env, registry].filter(Boolean).join(" ");
}

function resolveDeploySkill(target: DeployTarget): string {
  switch (target) {
    case "helm":
      return "helm";
    case "kubernetes":
    case "argocd": // ArgoCD deploys raw K8s manifests
      return "kubernetes";
    case "docker-compose":
      return "docker-compose";
    case "ecs":
      return "ecs";
    default:
      // Targets without dedicated skills (bare-metal, serverless) use generic agent
      return "generic";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
