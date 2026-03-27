import pc from "picocolors";
import * as p from "@clack/prompts";
import { scanRepo, RepoContext } from "@dojops/core";
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

// ── Command handler ──────────────────────────────────────────────────

export const ariseCommand = async (args: string[], ctx: CLIContext): Promise<void> => {
  const autoApprove = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const dryRun = hasFlag(args, "--dry-run") || ctx.globalOpts.dryRun;
  const skipVerify = hasFlag(args, "--skip-verify");
  const jsonOutput = ctx.globalOpts.output === "json";

  p.intro(pc.cyan(pc.bold("dojops arise")));

  // ── Phase 1: Analyze codebase ────────────────────────────────────

  const cwd = process.cwd();
  let root = findProjectRoot(cwd);
  if (!root) {
    initProject(cwd);
    root = cwd;
  }

  const s = p.spinner();
  s.start("Scanning repository...");
  let repoCtx: RepoContext;
  try {
    repoCtx = scanRepo(root);
  } catch (err) {
    s.stop("Scan failed.");
    throw new CLIError(ExitCode.GENERAL_ERROR, `Repository scan failed: ${toErrorMessage(err)}`);
  }
  s.stop("Repository scanned.");

  p.note(wrapForNote(formatScanSummary(repoCtx).join("\n")), "Repo analysis");

  // ── Phase 2: Gather preferences ──────────────────────────────────

  const prefs = autoApprove ? buildSmartDefaults(repoCtx) : await gatherPreferences(repoCtx);

  if (!prefs) return; // user cancelled

  // ── Phase 3: Render pipeline diagram ─────────────────────────────

  const diagram = renderPipelineDiagram(prefs, repoCtx);
  p.note(wrapForNote(diagram), "Pipeline design");

  const plannedFiles = listPlannedFiles(prefs);
  const fileList = plannedFiles.map((f) => `  ${pc.cyan("+")} ${f}`).join("\n");
  p.note(wrapForNote(fileList), `Files to generate (${plannedFiles.length})`);

  if (dryRun) {
    p.outro(pc.dim("Dry run complete. No files were generated."));
    return;
  }

  if (!autoApprove) {
    const confirmed = await p.confirm({ message: "Generate this pipeline?" });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Cancelled.");
      return;
    }
  }

  // ── Phase 4: Generate artifacts ──────────────────────────────────

  const provider = ctx.getProvider();
  const projectContext = buildFileTree(root);
  const registry = createSkillRegistry(provider, root, {
    onBinaryMissing: createAutoInstallHandler((msg) => p.log.info(msg)),
    projectContext: projectContext || undefined,
  });
  const tools = registry.getAll();
  const graph = buildAriseTaskGraph(prefs, repoCtx);

  // Display the task graph
  const taskLines = graph.tasks.map((task) => {
    const deps = task.dependsOn.length ? pc.dim(` (after: ${task.dependsOn.join(", ")})`) : "";
    return `  ${pc.blue(task.id)} ${pc.bold(task.tool)}: ${task.description}${deps}`;
  });
  p.note(wrapForNote(taskLines.join("\n")), truncateNoteTitle(`Tasks (${graph.tasks.length})`));

  const startTime = Date.now();
  const taskTimers = new Map<string, number>();
  const progress = jsonOutput ? null : createProgressReporter(graph.tasks.length);

  const executor = new PlannerExecutor(
    tools,
    {
      taskStart(id, desc) {
        if (progress) {
          progress.start(id, desc);
        } else {
          p.log.step(`Running ${pc.blue(id)}: ${desc}`);
        }
        taskTimers.set(id, Date.now());
      },
      taskEnd(id, _status, error) {
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

  const planResult = await executor.execute(graph);
  progress?.done();

  // ── Phase 5: Validate and write files ────────────────────────────

  let critic: import("@dojops/executor").CriticCallback | undefined;
  try {
    const { CriticAgent } = await import("@dojops/core");
    critic = new CriticAgent(provider);
  } catch {
    // CriticAgent not available
  }

  const safeExecutor = new SafeExecutor({
    policy: {
      allowWrite: true,
      requireApproval: !autoApprove,
      approvalMode: autoApprove ? "never" : "risk-based",
      autoApproveRiskLevel: "MEDIUM",
      timeoutMs: 120_000,
      executeTimeoutMs: 10 * 60_000,
      skipVerification: skipVerify,
      enforceDevOpsAllowlist: true,
      maxRepairAttempts: 3,
    },
    approvalHandler: autoApprove ? new AutoApproveHandler() : cliApprovalHandler(),
    critic,
    progress: jsonOutput
      ? undefined
      : {
          onVerificationFailed(taskId, errors) {
            p.log.warn(
              `Verification failed for ${pc.bold(taskId)} (${errors.length} error${errors.length === 1 ? "" : "s"}). Starting self-repair...`,
            );
          },
          onRepairAttempt(taskId, attempt, maxAttempts) {
            p.log.info(
              `${pc.yellow("\u21bb")} Repairing ${pc.bold(taskId)} (attempt ${attempt}/${maxAttempts})`,
            );
          },
          onVerificationPassed(taskId) {
            p.log.success(`Self-repair succeeded for ${pc.bold(taskId)}`);
          },
        },
  });

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const allFilesCreated: string[] = [];
  const verifyResults: { id: string; passed: boolean; issues: number; errors: string[] }[] = [];

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

  // ── Phase 6: Summary ─────────────────────────────────────────────

  const elapsed = Date.now() - startTime;

  // Verification summary with error details
  const verifyLines: string[] = [];
  for (const r of verifyResults) {
    const icon = r.passed ? pc.green("\u2713") : pc.red("\u2717");
    const issueHint =
      r.issues > 0 ? pc.dim(` (${r.issues} issue${r.issues === 1 ? "" : "s"})`) : "";
    verifyLines.push(`  ${icon} ${r.id}${issueHint}`);
    if (!r.passed && r.errors.length > 0) {
      for (const msg of r.errors.slice(0, 5)) {
        verifyLines.push(`    ${pc.dim("- " + msg)}`);
      }
      if (r.errors.length > 5) {
        verifyLines.push(`    ${pc.dim(`... and ${r.errors.length - 5} more`)}`);
      }
    }
  }
  p.note(wrapForNote(verifyLines.join("\n")), "Verification");

  // Files created summary
  if (allFilesCreated.length > 0) {
    const fileLines = allFilesCreated.map((f) => `  ${pc.green("+")} ${f}`).join("\n");
    p.note(wrapForNote(fileLines), `Files created (${allFilesCreated.length})`);
  }

  // Persist audit entry
  try {
    await appendAudit(root, {
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

  // Save plan state for reproducibility
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

  const successCount = verifyResults.filter((r) => r.passed).length;
  const totalCount = verifyResults.length;
  const color = successCount === totalCount ? pc.green : pc.yellow;
  p.outro(
    color(
      `Pipeline generated: ${successCount}/${totalCount} tasks succeeded in ${fmtDuration(elapsed)}`,
    ),
  );
};

// ── Smart defaults from scan ─────────────────────────────────────────

function buildSmartDefaults(ctx: RepoContext): PipelinePreferences {
  // CI platform
  let ciPlatform: CIPlatform = "github-actions";
  if (ctx.ci.length > 0) {
    const detected = ctx.ci[0].platform;
    if (detected === "github-actions" || detected === "gitlab-ci" || detected === "jenkinsfile") {
      ciPlatform = detected;
    }
  }

  // Stages
  const stages: PipelineStage[] = ["build", "test", "lint"];
  if (ctx.container.hasDockerfile || ctx.container.hasCompose) {
    stages.push("containerize");
  }
  if (ctx.security?.hasDependabot || ctx.security?.hasRenovate) {
    stages.push("security-scan");
  }
  if (
    ctx.infra.hasKubernetes ||
    ctx.infra.hasHelm ||
    ctx.infra.hasTerraform ||
    ctx.container.hasCompose
  ) {
    stages.push("deploy");
  }

  // Container registry
  let containerRegistry: ContainerRegistry | undefined;
  if (stages.includes("containerize")) {
    containerRegistry = ciPlatform === "github-actions" ? "ghcr" : "dockerhub";
  }

  // Deploy target
  let deployTarget: DeployTarget | undefined;
  if (stages.includes("deploy")) {
    if (ctx.infra.hasHelm) deployTarget = "helm";
    else if (ctx.infra.hasKubernetes) deployTarget = "kubernetes";
    else if (ctx.container.hasCompose) deployTarget = "docker-compose";
    else deployTarget = "kubernetes";
  }

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

async function gatherPreferences(ctx: RepoContext): Promise<PipelinePreferences | null> {
  const defaults = buildSmartDefaults(ctx);

  // 1. CI platform
  const detectedCI = ctx.ci.length > 0 ? ctx.ci[0].platform : null;
  const ciChoice = await p.select({
    message: "CI/CD platform:",
    options: [
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
    ],
    initialValue: defaults.ciPlatform,
  });
  if (p.isCancel(ciChoice)) {
    p.cancel("Cancelled.");
    return null;
  }

  // 2. Pipeline stages
  const stageChoice = await p.multiselect({
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
  });
  if (p.isCancel(stageChoice)) {
    p.cancel("Cancelled.");
    return null;
  }
  const stages = stageChoice as PipelineStage[];

  // 3. Container registry (conditional)
  let containerRegistry: ContainerRegistry | undefined;
  if (stages.includes("containerize") || stages.includes("publish-artifacts")) {
    const registryChoice = await p.select({
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
    });
    if (p.isCancel(registryChoice)) {
      p.cancel("Cancelled.");
      return null;
    }
    containerRegistry = registryChoice as ContainerRegistry;
  }

  // 4. Security scanner (conditional)
  let securityScanner: SecurityScanner | undefined;
  if (stages.includes("security-scan")) {
    const scannerChoice = await p.select({
      message: "Security scanner:",
      options: [
        { value: "trivy" as SecurityScanner, label: "Trivy (open-source, recommended)" },
        { value: "snyk" as SecurityScanner, label: "Snyk" },
        { value: "grype" as SecurityScanner, label: "Grype (Anchore)" },
        { value: "falco" as SecurityScanner, label: "Falco (runtime security)" },
      ],
      initialValue: "trivy" as SecurityScanner,
    });
    if (p.isCancel(scannerChoice)) {
      p.cancel("Cancelled.");
      return null;
    }
    securityScanner = scannerChoice as SecurityScanner;
  }

  // 5. Deploy target (conditional)
  let deployTarget: DeployTarget | undefined;
  if (stages.includes("deploy")) {
    const deployChoice = await p.select({
      message: "Deployment target:",
      options: [
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
      ],
      initialValue: (defaults.deployTarget ?? "kubernetes") as DeployTarget,
    });
    if (p.isCancel(deployChoice)) {
      p.cancel("Cancelled.");
      return null;
    }
    deployTarget = deployChoice as DeployTarget;
  }

  // 6. Environment strategy
  const envChoice = await p.select({
    message: "Environment strategy:",
    options: [
      { value: "single" as EnvStrategy, label: "Single environment" },
      { value: "staging-prod" as EnvStrategy, label: "Staging + Production" },
      { value: "dev-staging-prod" as EnvStrategy, label: "Dev + Staging + Production" },
    ],
    initialValue: "staging-prod" as EnvStrategy,
  });
  if (p.isCancel(envChoice)) {
    p.cancel("Cancelled.");
    return null;
  }

  // 7. Notifications
  const notifChoice = await p.select({
    message: "Notifications:",
    options: [
      { value: "none" as NotificationTarget, label: "None" },
      { value: "slack" as NotificationTarget, label: "Slack" },
      { value: "email" as NotificationTarget, label: "Email" },
    ],
    initialValue: "none" as NotificationTarget,
  });
  if (p.isCancel(notifChoice)) {
    p.cancel("Cancelled.");
    return null;
  }

  return {
    ciPlatform: ciChoice as CIPlatform,
    stages,
    containerRegistry,
    securityScanner,
    deployTarget,
    envStrategy: envChoice as EnvStrategy,
    notifications: notifChoice as NotificationTarget,
  };
}

// ── TaskGraph construction ───────────────────────────────────────────

function buildAriseTaskGraph(prefs: PipelinePreferences, ctx: RepoContext): TaskGraph {
  const tasks: TaskNode[] = [];
  const lang = ctx.primaryLanguage ?? "the project";
  const pkgMgr = ctx.packageManager?.name ?? "make";
  const envLabel =
    prefs.envStrategy === "single"
      ? "single environment"
      : prefs.envStrategy === "staging-prod"
        ? "staging and production environments"
        : "dev, staging, and production environments";

  // Always: the CI workflow
  const stageList = prefs.stages.join(", ");
  const ciPrompt = [
    `Generate a ${prefs.ciPlatform} CI/CD pipeline for a ${lang} project using ${pkgMgr}.`,
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
      ? `Deploy to ${prefs.deployTarget ?? "kubernetes"} with ${envLabel}.`
      : "",
    prefs.notifications !== "none" ? `Send ${prefs.notifications} notifications on failure.` : "",
    ctx.meta.isMonorepo ? "This is a monorepo; set up matrix or per-package jobs." : "",
  ]
    .filter(Boolean)
    .join(" ");

  tasks.push({
    id: "ci-workflow",
    tool: SKILL_MAP[prefs.ciPlatform] ?? "github-actions",
    description: ciPrompt,
    dependsOn: [],
    input: { prompt: ciPrompt },
  });

  // Dockerfile (parallel with CI)
  if (prefs.stages.includes("containerize")) {
    const dockerPrompt = `Generate a production Dockerfile for a ${lang} project using ${pkgMgr}. Use multi-stage build, non-root user, and minimal image. Include a .dockerignore file.`;
    tasks.push({
      id: "dockerfile",
      tool: "dockerfile",
      description: dockerPrompt,
      dependsOn: [],
      input: { prompt: dockerPrompt },
    });
  }

  // Deploy config (depends on dockerfile if containerize is selected)
  if (prefs.stages.includes("deploy") && prefs.deployTarget) {
    const deps = prefs.stages.includes("containerize") ? ["dockerfile"] : [];
    const deployPrompt = buildDeployPrompt(prefs, ctx, envLabel);
    const deploySkill = resolveDeploySkill(prefs.deployTarget);

    tasks.push({
      id: "deploy-config",
      tool: deploySkill,
      description: deployPrompt,
      dependsOn: deps,
      input: { prompt: deployPrompt },
    });
  }

  // Trivy operator for in-cluster scanning (parallel)
  if (
    prefs.stages.includes("security-scan") &&
    prefs.securityScanner === "trivy" &&
    (prefs.deployTarget === "kubernetes" || prefs.deployTarget === "helm")
  ) {
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

  // Falco rules (parallel)
  if (prefs.stages.includes("security-scan") && prefs.securityScanner === "falco") {
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
