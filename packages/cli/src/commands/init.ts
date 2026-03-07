import fs from "node:fs";
import path from "node:path";
import { runBin } from "../safe-exec";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { scanRepo, enrichWithLLM } from "@dojops/core";
import type { RepoContext, LLMInsights } from "@dojops/core";
import { CLIContext, CommandHandler } from "../types";
import { toErrorMessage } from "../exit-codes";
import { initProject, findProjectRoot } from "../state";
import { offerToolInstall, offerSystemToolInstall } from "../preflight";
import { hasFlag } from "../parser";

function collectInfraParts(ctx: RepoContext): string[] {
  const parts: string[] = [];
  if (ctx.infra.hasTerraform) {
    const providersSuffix =
      ctx.infra.tfProviders.length > 0 ? ` [${ctx.infra.tfProviders.join(", ")}]` : "";
    parts.push(`Terraform${providersSuffix}`);
  }
  if (ctx.infra.hasKubernetes) parts.push("Kubernetes");
  if (ctx.infra.hasHelm) parts.push("Helm");
  if (ctx.infra.hasAnsible) parts.push("Ansible");
  if (ctx.infra.hasKustomize) parts.push("Kustomize");
  if (ctx.infra.hasVagrant) parts.push("Vagrant");
  if (ctx.infra.hasPulumi) parts.push("Pulumi");
  if (ctx.infra.hasCloudFormation) parts.push("CloudFormation");
  if (ctx.infra.hasPacker) parts.push("Packer");
  return parts;
}

function collectMonitoringParts(ctx: RepoContext): string[] {
  const parts: string[] = [];
  if (ctx.monitoring.hasPrometheus) parts.push("Prometheus");
  if (ctx.monitoring.hasNginx) parts.push("Nginx");
  if (ctx.monitoring.hasSystemd) parts.push("Systemd");
  if (ctx.monitoring.hasHaproxy) parts.push("HAProxy");
  if (ctx.monitoring.hasTomcat) parts.push("Tomcat");
  if (ctx.monitoring.hasApache) parts.push("Apache");
  if (ctx.monitoring.hasCaddy) parts.push("Caddy");
  if (ctx.monitoring.hasEnvoy) parts.push("Envoy");
  return parts;
}

function collectSecurityParts(ctx: RepoContext): string[] {
  const parts: string[] = [];
  if (ctx.security.hasGitignore) parts.push(".gitignore");
  if (ctx.security.hasEnvExample) parts.push(".env.example");
  if (ctx.security.hasCodeowners) parts.push("CODEOWNERS");
  if (ctx.security.hasSecurityPolicy) parts.push("SECURITY.md");
  if (ctx.security.hasDependabot) parts.push("Dependabot");
  if (ctx.security.hasRenovate) parts.push("Renovate");
  if (ctx.security.hasEditorConfig) parts.push(".editorconfig");
  return parts;
}

function collectContainerParts(ctx: RepoContext): string[] {
  const parts: string[] = [];
  if (ctx.container.hasDockerfile) parts.push("Dockerfile");
  if (ctx.container.hasCompose) parts.push(`Compose (${ctx.container.composePath})`);
  if (ctx.container.hasSwarm) parts.push("Docker Swarm");
  return parts;
}

function collectMetaParts(ctx: RepoContext): string[] {
  const parts: string[] = [];
  if (ctx.meta.isGitRepo) parts.push("git");
  if (ctx.meta.isMonorepo) parts.push("monorepo");
  if (ctx.meta.hasMakefile) parts.push("Makefile");
  return parts;
}

function appendIfNonEmpty(lines: string[], label: string, parts: string[]): void {
  if (parts.length > 0) {
    lines.push(`${pc.cyan(label)} ${parts.join(", ")}`);
  }
}

function formatLanguagesSummary(ctx: RepoContext): string[] {
  if (ctx.languages.length === 0) {
    return [`${pc.cyan("Languages:")}     ${pc.dim("none detected")}`];
  }
  const langs = ctx.languages.map((l) => `${l.name} (${l.indicator})`).join(", ");
  const lines = [`${pc.cyan("Languages:")}     ${langs}`];
  if (ctx.primaryLanguage) lines.push(`${pc.cyan("Primary:")}       ${ctx.primaryLanguage}`);
  return lines;
}

function collectScriptParts(ctx: RepoContext): string[] {
  if (!ctx.scripts) return [];
  const parts: string[] = [];
  if (ctx.scripts.shellScripts.length > 0) parts.push(`${ctx.scripts.shellScripts.length} shell`);
  if (ctx.scripts.pythonScripts.length > 0)
    parts.push(`${ctx.scripts.pythonScripts.length} python`);
  if (ctx.scripts.hasJustfile) parts.push("Justfile");
  return parts;
}

function formatScanSummary(ctx: RepoContext): string[] {
  const lines: string[] = [...formatLanguagesSummary(ctx)];

  if (ctx.packageManager) {
    const lockfileSuffix = ctx.packageManager.lockfile ? ` (${ctx.packageManager.lockfile})` : "";
    lines.push(`${pc.cyan("Pkg manager:")}   ${ctx.packageManager.name}${lockfileSuffix}`);
  }

  if (ctx.ci.length > 0) {
    const platforms = [...new Set(ctx.ci.map((c) => c.platform))].join(", ");
    lines.push(`${pc.cyan("CI/CD:")}         ${platforms}`);
  }

  appendIfNonEmpty(lines, "Container:", collectContainerParts(ctx));
  appendIfNonEmpty(lines, "Infra:", collectInfraParts(ctx));
  appendIfNonEmpty(lines, "Monitoring:", collectMonitoringParts(ctx));
  appendIfNonEmpty(lines, "Scripts:", collectScriptParts(ctx));
  if (ctx.security) appendIfNonEmpty(lines, "Security:", collectSecurityParts(ctx));

  if (ctx.devopsFiles && ctx.devopsFiles.length > 0) {
    lines.push(`${pc.cyan("DevOps files:")} ${ctx.devopsFiles.length} detected`);
  }

  appendIfNonEmpty(lines, "Meta:", collectMetaParts(ctx));

  if (ctx.relevantDomains.length > 0) {
    lines.push(`${pc.cyan("Agent domains:")} ${ctx.relevantDomains.join(", ")}`);
  }

  return lines;
}

function formatLLMInsights(insights: LLMInsights): string[] {
  const lines: string[] = [];

  lines.push(`${pc.cyan("Description:")}   ${insights.projectDescription}`, "");

  if (insights.techStack.length > 0) {
    lines.push(`${pc.cyan("Tech stack:")}    ${insights.techStack.join(", ")}`);
  }

  if (insights.suggestedWorkflows.length > 0) {
    lines.push("", `${pc.cyan("Suggested workflows:")}`);
    for (const wf of insights.suggestedWorkflows) {
      lines.push(`  ${pc.green("$")} ${wf.command}`, `    ${pc.dim(wf.description)}`);
    }
  }

  if (insights.recommendedAgents.length > 0) {
    lines.push("", `${pc.cyan("Recommended agents:")} ${insights.recommendedAgents.join(", ")}`);
  }

  if (insights.notes) {
    lines.push("", `${pc.cyan("Notes:")}         ${insights.notes}`);
  }

  return lines;
}

function mdSection(lines: string[], heading: string, items: string[], emptyMsg: string): void {
  lines.push("", `## ${heading}`, "");
  if (items.length > 0) {
    for (const item of items) lines.push(`- ${item}`);
  } else {
    lines.push(emptyMsg);
  }
}

function collectInfraItemsMd(ctx: RepoContext): string[] {
  const items: string[] = [];
  if (ctx.infra.hasTerraform) {
    const providers =
      ctx.infra.tfProviders.length > 0 ? ` (providers: ${ctx.infra.tfProviders.join(", ")})` : "";
    items.push(`Terraform${providers}${ctx.infra.hasState ? " [has state]" : ""}`);
  }
  if (ctx.infra.hasKubernetes) items.push("Kubernetes");
  if (ctx.infra.hasHelm) items.push("Helm");
  if (ctx.infra.hasAnsible) items.push("Ansible");
  if (ctx.infra.hasKustomize) items.push("Kustomize");
  if (ctx.infra.hasVagrant) items.push("Vagrant");
  if (ctx.infra.hasPulumi) items.push("Pulumi");
  if (ctx.infra.hasCloudFormation) items.push("CloudFormation");
  if (ctx.infra.hasPacker) items.push("Packer");
  return items;
}

function collectContainerItemsMd(ctx: RepoContext): string[] {
  const items: string[] = [];
  if (ctx.container.hasDockerfile) items.push("Dockerfile");
  if (ctx.container.hasCompose) items.push(`Docker Compose (\`${ctx.container.composePath}\`)`);
  if (ctx.container.hasSwarm) items.push("Docker Swarm");
  return items;
}

function collectMetaItemsMd(ctx: RepoContext): string[] {
  const items: string[] = [];
  if (ctx.meta.isGitRepo) items.push("Git repository");
  if (ctx.meta.isMonorepo) items.push("Monorepo");
  if (ctx.meta.hasMakefile) items.push("Makefile");
  if (ctx.meta.hasReadme) items.push("README");
  if (ctx.meta.hasEnvFile) items.push(".env file");
  return items;
}

function formatLLMInsightsMd(insights: LLMInsights): string[] {
  const lines: string[] = [];
  lines.push("## LLM Insights", "", `**Description:** ${insights.projectDescription}`, "");
  if (insights.techStack.length > 0) {
    lines.push(`**Tech Stack:** ${insights.techStack.join(", ")}`, "");
  }
  if (insights.suggestedWorkflows.length > 0) {
    lines.push("**Suggested Workflows:**", "");
    for (const wf of insights.suggestedWorkflows) {
      lines.push(`- \`${wf.command}\` — ${wf.description}`);
    }
    lines.push("");
  }
  if (insights.recommendedAgents.length > 0) {
    lines.push(`**Recommended Agents:** ${insights.recommendedAgents.join(", ")}`, "");
  }
  if (insights.notes) {
    lines.push(`**Notes:** ${insights.notes}`, "");
  }
  return lines;
}

function formatLanguagesMd(ctx: RepoContext): string[] {
  const lines: string[] = ["## Languages", ""];
  if (ctx.languages.length > 0) {
    for (const l of ctx.languages) {
      lines.push(`- **${l.name}** (${l.indicator}, confidence: ${l.confidence.toFixed(2)})`);
    }
    if (ctx.primaryLanguage) {
      lines.push("", `Primary language: **${ctx.primaryLanguage}**`);
    }
  } else {
    lines.push("No languages detected.");
  }
  return lines;
}

function formatPackageManagerMd(ctx: RepoContext): string[] {
  const lines: string[] = ["", "## Package Manager", ""];
  if (ctx.packageManager) {
    const lockfileSuffix = ctx.packageManager.lockfile ? ` (${ctx.packageManager.lockfile})` : "";
    lines.push(`- ${ctx.packageManager.name}${lockfileSuffix}`);
  } else {
    lines.push("No package manager detected.");
  }
  return lines;
}

function formatCICDMd(ctx: RepoContext): string[] {
  const lines: string[] = ["", "## CI/CD", ""];
  if (ctx.ci.length > 0) {
    for (const c of ctx.ci) {
      lines.push("- **" + c.platform + "**: `" + c.configPath + "`");
    }
  } else {
    lines.push("No CI/CD configurations detected.");
  }
  return lines;
}

function collectScriptItemsMd(ctx: RepoContext): string[] {
  const items: string[] = [];
  if (ctx.scripts.shellScripts.length > 0)
    items.push(`Shell scripts: ${ctx.scripts.shellScripts.join(", ")}`);
  if (ctx.scripts.pythonScripts.length > 0)
    items.push(`Python scripts: ${ctx.scripts.pythonScripts.join(", ")}`);
  if (ctx.scripts.hasJustfile) items.push("Justfile");
  return items;
}

export function formatContextMarkdown(ctx: RepoContext): string {
  const lines: string[] = [
    "# Project Context",
    "",
    `> Auto-generated by \`dojops init\` on ${ctx.scannedAt}`,
    "",
    ...formatLanguagesMd(ctx),
    ...formatPackageManagerMd(ctx),
    ...formatCICDMd(ctx),
  ];

  mdSection(
    lines,
    "Container",
    collectContainerItemsMd(ctx),
    "No container configurations detected.",
  );
  mdSection(lines, "Infrastructure", collectInfraItemsMd(ctx), "No infrastructure tools detected.");
  mdSection(
    lines,
    "Monitoring",
    collectMonitoringParts(ctx),
    "No monitoring/web server configurations detected.",
  );
  mdSection(lines, "Scripts", collectScriptItemsMd(ctx), "No scripts detected.");
  mdSection(lines, "Security", collectSecurityParts(ctx), "No security configurations detected.");

  lines.push("", "## Metadata", "");
  for (const item of collectMetaItemsMd(ctx)) lines.push(`- ${item}`);
  lines.push("");

  if (ctx.devopsFiles.length > 0) {
    lines.push("## DevOps Files", "");
    for (const f of ctx.devopsFiles) lines.push(`- \`${f}\``);
    lines.push("");
  }

  if (ctx.llmInsights) {
    lines.push(...formatLLMInsightsMd(ctx.llmInsights));
  }

  lines.push(
    "## Additional Context",
    "",
    "<!-- Add any additional project context, notes, or custom information below. -->",
    "<!-- This section is preserved across re-runs of `dojops init`. -->",
    "",
  );

  return lines.join("\n");
}

function hasProjectSignals(ctx: RepoContext): boolean {
  return (
    (ctx.devopsFiles != null && ctx.devopsFiles.length > 0) ||
    !!ctx.primaryLanguage ||
    ctx.ci.length > 0 ||
    ctx.container.hasDockerfile ||
    ctx.infra.hasTerraform ||
    ctx.infra.hasKubernetes
  );
}

function ensureInsightDescription(insights: LLMInsights, ctx: RepoContext): void {
  if (insights.projectDescription && insights.projectDescription.trim() !== "") return;
  const langPart = ctx.primaryLanguage ? `${ctx.primaryLanguage} ` : "";
  const parts: string[] = [];
  if (ctx.infra.hasTerraform) parts.push("Terraform");
  if (ctx.infra.hasKubernetes) parts.push("Kubernetes");
  if (ctx.container.hasDockerfile) parts.push("Docker");
  insights.projectDescription =
    parts.length > 0
      ? `A ${langPart}project with ${parts.join(", ")} infrastructure.`
      : `A ${langPart}software project.`;
}

async function runLLMEnrichment(
  provider: Parameters<typeof enrichWithLLM>[1] | undefined,
  ctx: RepoContext,
  contextPath: string,
  contextMdPath: string,
  isStructured: boolean,
): Promise<void> {
  if (!provider) {
    p.log.info(`Run ${pc.cyan("dojops config")} to enable LLM-powered project analysis.`);
    return;
  }

  if (!hasProjectSignals(ctx)) {
    p.log.info(pc.dim("No project files detected. Skipping LLM analysis."));
    return;
  }

  const enrichSpinner = p.spinner();
  if (!isStructured) enrichSpinner.start("Analyzing project with LLM...");
  try {
    const insights = await enrichWithLLM(ctx, provider);
    ensureInsightDescription(insights, ctx);

    ctx.llmInsights = insights;
    fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2) + "\n");
    fs.writeFileSync(contextMdPath, formatContextMarkdown(ctx));

    if (!isStructured) enrichSpinner.stop("LLM analysis complete.");

    const insightLines = formatLLMInsights(insights);
    p.note(insightLines.join("\n"), "LLM project insights");
  } catch (err) {
    if (!isStructured) enrichSpinner.stop("LLM analysis failed.");
    p.log.warn(`LLM enrichment skipped: ${toErrorMessage(err)}`);
  }
}

const EDITOR_ALLOWLIST = [
  "vim",
  "vi",
  "nano",
  "code",
  "emacs",
  "subl",
  "gedit",
  "notepad",
  "notepad++",
  "kate",
  "micro",
];

async function offerContextReview(contextMdPath: string): Promise<void> {
  const review = await p.confirm({
    message: "Review and edit the project context?",
    initialValue: false,
  });

  if (p.isCancel(review) || !review) return;

  const editor = process.env.EDITOR || process.env.VISUAL;
  if (!editor) {
    p.log.info(`Edit the context file at: ${pc.cyan(contextMdPath)}`);
    p.log.info(`Set ${pc.cyan("$EDITOR")} to open it automatically next time.`);
    return;
  }

  const editorParts = editor.split(/\s+/);
  const editorBinary = path.basename(editorParts[0]);
  if (!EDITOR_ALLOWLIST.includes(editorBinary)) {
    p.log.warn(
      `Editor ${pc.cyan(editorBinary)} is not in the allowed list (${EDITOR_ALLOWLIST.join(", ")}). Skipping.`,
    );
    p.log.info(`Edit the context file manually: ${pc.cyan(contextMdPath)}`);
    return;
  }

  p.log.info(`Opening ${pc.cyan(contextMdPath)} in ${pc.cyan(editor)}...`);
  try {
    runBin(editorParts[0], [...editorParts.slice(1), contextMdPath], {
      stdio: "inherit",
    });
    p.log.success("Context file updated.");
  } catch {
    p.log.warn(`Could not open editor. Edit manually: ${pc.dim(contextMdPath)}`);
  }
}

function reportInitResult(
  alreadyExists: boolean,
  created: string[],
  ctx: RepoContext | undefined,
  root: string,
  contextPath: string,
): void {
  if (alreadyExists && created.length === 0) {
    p.log.info("Project already initialized — context updated.");
    p.log.info(`  ${pc.dim(contextPath)}`);
  } else {
    const lines = created.map((f) => `  ${pc.green("+")} ${f}`);
    if (ctx) lines.push(`  ${pc.green("+")} .dojops/context.json`);
    p.note(lines.join("\n"), `Initialized .dojops/ in ${pc.dim(root)}`);
    p.log.success("Project initialized.");
  }
}

async function handleRepoScan(
  root: string,
  contextPath: string,
  contextMdPath: string,
  cliCtx: CLIContext,
  skipReview: boolean,
  isStructured: boolean,
): Promise<RepoContext> {
  const s = p.spinner();
  if (!isStructured) s.start("Scanning repository...");
  const ctx = scanRepo(root);
  fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2) + "\n");
  if (!isStructured) s.stop("Repository scanned.");

  p.note(formatScanSummary(ctx).join("\n"), "Repo scan results");
  fs.writeFileSync(contextMdPath, formatContextMarkdown(ctx));

  let provider;
  try {
    provider = cliCtx.getProvider();
  } catch {
    // No provider configured — that's fine
  }
  await runLLMEnrichment(provider, ctx, contextPath, contextMdPath, isStructured);

  if (!skipReview && !cliCtx.globalOpts.nonInteractive) {
    await offerContextReview(contextMdPath);
  }
  p.log.info(`Context: ${pc.dim(contextMdPath)}`);
  return ctx;
}

export const initCommand: CommandHandler = async (_args, cliCtx) => {
  const skipScan = hasFlag(_args, "--skip-scan");
  const skipTools = hasFlag(_args, "--skip-tools");
  const skipReview = hasFlag(_args, "--skip-review");

  const root = findProjectRoot() ?? process.cwd();
  const alreadyExists = fs.existsSync(path.join(root, ".dojops"));
  const created = initProject(root);

  const isStructured = cliCtx.globalOpts.output !== "table";
  const contextPath = path.join(root, ".dojops", "context.json");
  const contextMdPath = path.join(root, ".dojops", "context.md");

  let ctx: RepoContext | undefined;
  if (skipScan) {
    p.log.info(pc.dim("Skipped repository scan (--skip-scan)."));
  } else {
    ctx = await handleRepoScan(root, contextPath, contextMdPath, cliCtx, skipReview, isStructured);
  }

  reportInitResult(alreadyExists, created, ctx, root, contextPath);

  if (skipTools) {
    p.log.info(pc.dim("Skipped tool installation (--skip-tools)."));
  } else {
    const domains = ctx?.relevantDomains ?? [];
    await offerToolInstall({
      nonInteractive: cliCtx.globalOpts.nonInteractive,
      domains,
    });
    await offerSystemToolInstall({
      nonInteractive: cliCtx.globalOpts.nonInteractive,
      domains,
    });
  }
};
