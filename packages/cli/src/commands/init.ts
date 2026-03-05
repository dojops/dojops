import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { scanRepo, enrichWithLLM } from "@dojops/core";
import type { RepoContext, LLMInsights } from "@dojops/core";
import { CommandHandler } from "../types";
import { initProject, findProjectRoot } from "../state";
import { offerToolInstall, offerSystemToolInstall } from "../preflight";

function formatScanSummary(ctx: RepoContext): string[] {
  const lines: string[] = [];

  // Languages
  if (ctx.languages.length > 0) {
    const langs = ctx.languages.map((l) => `${l.name} (${l.indicator})`).join(", ");
    lines.push(`${pc.cyan("Languages:")}     ${langs}`);
    if (ctx.primaryLanguage) {
      lines.push(`${pc.cyan("Primary:")}       ${ctx.primaryLanguage}`);
    }
  } else {
    lines.push(`${pc.cyan("Languages:")}     ${pc.dim("none detected")}`);
  }

  // Package manager
  if (ctx.packageManager) {
    lines.push(
      `${pc.cyan("Pkg manager:")}   ${ctx.packageManager.name}${ctx.packageManager.lockfile ? ` (${ctx.packageManager.lockfile})` : ""}`,
    );
  }

  // CI/CD
  if (ctx.ci.length > 0) {
    const platforms = [...new Set(ctx.ci.map((c) => c.platform))].join(", ");
    lines.push(`${pc.cyan("CI/CD:")}         ${platforms}`);
  }

  // Container
  const containerParts: string[] = [];
  if (ctx.container.hasDockerfile) containerParts.push("Dockerfile");
  if (ctx.container.hasCompose) containerParts.push(`Compose (${ctx.container.composePath})`);
  if (ctx.container.hasSwarm) containerParts.push("Docker Swarm");
  if (containerParts.length > 0) {
    lines.push(`${pc.cyan("Container:")}     ${containerParts.join(", ")}`);
  }

  // Infrastructure
  const infraParts: string[] = [];
  if (ctx.infra.hasTerraform)
    infraParts.push(
      `Terraform${ctx.infra.tfProviders.length > 0 ? ` [${ctx.infra.tfProviders.join(", ")}]` : ""}`,
    );
  if (ctx.infra.hasKubernetes) infraParts.push("Kubernetes");
  if (ctx.infra.hasHelm) infraParts.push("Helm");
  if (ctx.infra.hasAnsible) infraParts.push("Ansible");
  if (ctx.infra.hasKustomize) infraParts.push("Kustomize");
  if (ctx.infra.hasVagrant) infraParts.push("Vagrant");
  if (ctx.infra.hasPulumi) infraParts.push("Pulumi");
  if (ctx.infra.hasCloudFormation) infraParts.push("CloudFormation");
  if (ctx.infra.hasPacker) infraParts.push("Packer");
  if (infraParts.length > 0) {
    lines.push(`${pc.cyan("Infra:")}         ${infraParts.join(", ")}`);
  }

  // Monitoring / Web servers
  const monParts: string[] = [];
  if (ctx.monitoring.hasPrometheus) monParts.push("Prometheus");
  if (ctx.monitoring.hasNginx) monParts.push("Nginx");
  if (ctx.monitoring.hasSystemd) monParts.push("Systemd");
  if (ctx.monitoring.hasHaproxy) monParts.push("HAProxy");
  if (ctx.monitoring.hasTomcat) monParts.push("Tomcat");
  if (ctx.monitoring.hasApache) monParts.push("Apache");
  if (ctx.monitoring.hasCaddy) monParts.push("Caddy");
  if (ctx.monitoring.hasEnvoy) monParts.push("Envoy");
  if (monParts.length > 0) {
    lines.push(`${pc.cyan("Monitoring:")}    ${monParts.join(", ")}`);
  }

  // Scripts
  if (ctx.scripts) {
    const scriptParts: string[] = [];
    if (ctx.scripts.shellScripts.length > 0)
      scriptParts.push(`${ctx.scripts.shellScripts.length} shell`);
    if (ctx.scripts.pythonScripts.length > 0)
      scriptParts.push(`${ctx.scripts.pythonScripts.length} python`);
    if (ctx.scripts.hasJustfile) scriptParts.push("Justfile");
    if (scriptParts.length > 0) {
      lines.push(`${pc.cyan("Scripts:")}       ${scriptParts.join(", ")}`);
    }
  }

  // Security
  if (ctx.security) {
    const secParts: string[] = [];
    if (ctx.security.hasGitignore) secParts.push(".gitignore");
    if (ctx.security.hasEnvExample) secParts.push(".env.example");
    if (ctx.security.hasCodeowners) secParts.push("CODEOWNERS");
    if (ctx.security.hasSecurityPolicy) secParts.push("SECURITY.md");
    if (ctx.security.hasDependabot) secParts.push("Dependabot");
    if (ctx.security.hasRenovate) secParts.push("Renovate");
    if (ctx.security.hasEditorConfig) secParts.push(".editorconfig");
    if (secParts.length > 0) {
      lines.push(`${pc.cyan("Security:")}      ${secParts.join(", ")}`);
    }
  }

  // DevOps files count
  if (ctx.devopsFiles && ctx.devopsFiles.length > 0) {
    lines.push(`${pc.cyan("DevOps files:")} ${ctx.devopsFiles.length} detected`);
  }

  // Metadata
  const metaParts: string[] = [];
  if (ctx.meta.isGitRepo) metaParts.push("git");
  if (ctx.meta.isMonorepo) metaParts.push("monorepo");
  if (ctx.meta.hasMakefile) metaParts.push("Makefile");
  if (metaParts.length > 0) {
    lines.push(`${pc.cyan("Meta:")}          ${metaParts.join(", ")}`);
  }

  // Relevant domains
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

export function formatContextMarkdown(ctx: RepoContext): string {
  const lines: string[] = [];
  lines.push(
    "# Project Context",
    "",
    `> Auto-generated by \`dojops init\` on ${ctx.scannedAt}`,
    "",
  );

  // Languages
  lines.push("## Languages", "");
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
  lines.push("");

  // Package Manager
  lines.push("## Package Manager", "");
  if (ctx.packageManager) {
    lines.push(
      `- ${ctx.packageManager.name}${ctx.packageManager.lockfile ? ` (${ctx.packageManager.lockfile})` : ""}`,
    );
  } else {
    lines.push("No package manager detected.");
  }
  lines.push("");

  // CI/CD
  lines.push("## CI/CD", "");
  if (ctx.ci.length > 0) {
    for (const c of ctx.ci) {
      lines.push("- **" + c.platform + "**: `" + c.configPath + "`");
    }
  } else {
    lines.push("No CI/CD configurations detected.");
  }
  lines.push("");

  // Container
  lines.push("## Container", "");
  const containerItems: string[] = [];
  if (ctx.container.hasDockerfile) containerItems.push("Dockerfile");
  if (ctx.container.hasCompose)
    containerItems.push(`Docker Compose (\`${ctx.container.composePath}\`)`);
  if (ctx.container.hasSwarm) containerItems.push("Docker Swarm");
  if (containerItems.length > 0) {
    for (const item of containerItems) lines.push(`- ${item}`);
  } else {
    lines.push("No container configurations detected.");
  }
  lines.push("");

  // Infrastructure
  lines.push("## Infrastructure", "");
  const infraItems: string[] = [];
  if (ctx.infra.hasTerraform) {
    const providers =
      ctx.infra.tfProviders.length > 0 ? ` (providers: ${ctx.infra.tfProviders.join(", ")})` : "";
    infraItems.push(`Terraform${providers}${ctx.infra.hasState ? " [has state]" : ""}`);
  }
  if (ctx.infra.hasKubernetes) infraItems.push("Kubernetes");
  if (ctx.infra.hasHelm) infraItems.push("Helm");
  if (ctx.infra.hasAnsible) infraItems.push("Ansible");
  if (ctx.infra.hasKustomize) infraItems.push("Kustomize");
  if (ctx.infra.hasVagrant) infraItems.push("Vagrant");
  if (ctx.infra.hasPulumi) infraItems.push("Pulumi");
  if (ctx.infra.hasCloudFormation) infraItems.push("CloudFormation");
  if (ctx.infra.hasPacker) infraItems.push("Packer");
  if (infraItems.length > 0) {
    for (const item of infraItems) lines.push(`- ${item}`);
  } else {
    lines.push("No infrastructure tools detected.");
  }
  lines.push("");

  // Monitoring
  lines.push("## Monitoring", "");
  const monItems: string[] = [];
  if (ctx.monitoring.hasPrometheus) monItems.push("Prometheus");
  if (ctx.monitoring.hasNginx) monItems.push("Nginx");
  if (ctx.monitoring.hasSystemd) monItems.push("Systemd");
  if (ctx.monitoring.hasHaproxy) monItems.push("HAProxy");
  if (ctx.monitoring.hasTomcat) monItems.push("Tomcat");
  if (ctx.monitoring.hasApache) monItems.push("Apache");
  if (ctx.monitoring.hasCaddy) monItems.push("Caddy");
  if (ctx.monitoring.hasEnvoy) monItems.push("Envoy");
  if (monItems.length > 0) {
    for (const item of monItems) lines.push(`- ${item}`);
  } else {
    lines.push("No monitoring/web server configurations detected.");
  }
  lines.push("");

  // Scripts
  lines.push("## Scripts", "");
  const scriptItems: string[] = [];
  if (ctx.scripts.shellScripts.length > 0)
    scriptItems.push(`Shell scripts: ${ctx.scripts.shellScripts.join(", ")}`);
  if (ctx.scripts.pythonScripts.length > 0)
    scriptItems.push(`Python scripts: ${ctx.scripts.pythonScripts.join(", ")}`);
  if (ctx.scripts.hasJustfile) scriptItems.push("Justfile");
  if (scriptItems.length > 0) {
    for (const item of scriptItems) lines.push(`- ${item}`);
  } else {
    lines.push("No scripts detected.");
  }
  lines.push("");

  // Security
  lines.push("## Security", "");
  const secItems: string[] = [];
  if (ctx.security.hasGitignore) secItems.push(".gitignore");
  if (ctx.security.hasEnvExample) secItems.push(".env.example");
  if (ctx.security.hasCodeowners) secItems.push("CODEOWNERS");
  if (ctx.security.hasSecurityPolicy) secItems.push("SECURITY.md");
  if (ctx.security.hasDependabot) secItems.push("Dependabot");
  if (ctx.security.hasRenovate) secItems.push("Renovate");
  if (ctx.security.hasEditorConfig) secItems.push(".editorconfig");
  if (secItems.length > 0) {
    for (const item of secItems) lines.push(`- ${item}`);
  } else {
    lines.push("No security configurations detected.");
  }
  lines.push("");

  // Metadata
  lines.push("## Metadata", "");
  const metaItems: string[] = [];
  if (ctx.meta.isGitRepo) metaItems.push("Git repository");
  if (ctx.meta.isMonorepo) metaItems.push("Monorepo");
  if (ctx.meta.hasMakefile) metaItems.push("Makefile");
  if (ctx.meta.hasReadme) metaItems.push("README");
  if (ctx.meta.hasEnvFile) metaItems.push(".env file");
  for (const item of metaItems) lines.push(`- ${item}`);
  lines.push("");

  // DevOps Files
  if (ctx.devopsFiles.length > 0) {
    lines.push("## DevOps Files", "");
    for (const f of ctx.devopsFiles) lines.push(`- \`${f}\``);
    lines.push("");
  }

  // LLM Insights (populated after enrichment)
  if (ctx.llmInsights) {
    lines.push("## LLM Insights", "", `**Description:** ${ctx.llmInsights.projectDescription}`, "");
    if (ctx.llmInsights.techStack.length > 0) {
      lines.push(`**Tech Stack:** ${ctx.llmInsights.techStack.join(", ")}`, "");
    }
    if (ctx.llmInsights.suggestedWorkflows.length > 0) {
      lines.push("**Suggested Workflows:**", "");
      for (const wf of ctx.llmInsights.suggestedWorkflows) {
        lines.push(`- \`${wf.command}\` — ${wf.description}`);
      }
      lines.push("");
    }
    if (ctx.llmInsights.recommendedAgents.length > 0) {
      lines.push(`**Recommended Agents:** ${ctx.llmInsights.recommendedAgents.join(", ")}`, "");
    }
    if (ctx.llmInsights.notes) {
      lines.push(`**Notes:** ${ctx.llmInsights.notes}`, "");
    }
  }

  // Additional Context (user editable)
  lines.push(
    "## Additional Context",
    "",
    "<!-- Add any additional project context, notes, or custom information below. -->",
    "<!-- This section is preserved across re-runs of `dojops init`. -->",
    "",
  );

  return lines.join("\n");
}

export const initCommand: CommandHandler = async (_args, cliCtx) => {
  const root = findProjectRoot() ?? process.cwd();
  const alreadyExists = fs.existsSync(path.join(root, ".dojops"));
  const created = initProject(root);

  // Scan the repository
  const isStructured = cliCtx.globalOpts.output !== "table";
  const s = p.spinner();
  if (!isStructured) s.start("Scanning repository...");
  const ctx = scanRepo(root);
  const contextPath = path.join(root, ".dojops", "context.json");
  fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2) + "\n");
  if (!isStructured) s.stop("Repository scanned.");

  if (alreadyExists && created.length === 0) {
    p.log.info("Project already initialized — context updated.");
    p.log.info(`  ${pc.dim(contextPath)}`);
  } else {
    const lines = created.map((f) => `  ${pc.green("+")} ${f}`);
    lines.push(`  ${pc.green("+")} .dojops/context.json`);
    p.note(lines.join("\n"), `Initialized .dojops/ in ${pc.dim(root)}`);
    p.log.success("Project initialized.");
  }

  // Display scan summary
  const summaryLines = formatScanSummary(ctx);
  p.note(summaryLines.join("\n"), "Repo scan results");

  // Write context.md
  const contextMdPath = path.join(root, ".dojops", "context.md");
  fs.writeFileSync(contextMdPath, formatContextMarkdown(ctx));

  // LLM enrichment (optional — only if a provider is configured)
  let provider;
  try {
    provider = cliCtx.getProvider();
  } catch {
    // No provider configured — that's fine
  }

  // UX #7: Skip LLM enrichment if no DevOps files and no primary language detected
  const hasProjectSignals =
    (ctx.devopsFiles && ctx.devopsFiles.length > 0) ||
    ctx.primaryLanguage ||
    ctx.ci.length > 0 ||
    ctx.container.hasDockerfile ||
    ctx.infra.hasTerraform ||
    ctx.infra.hasKubernetes;

  if (provider && !hasProjectSignals) {
    p.log.info(pc.dim("No project files detected. Skipping LLM analysis."));
  } else if (provider) {
    const enrichSpinner = p.spinner();
    if (!isStructured) enrichSpinner.start("Analyzing project with LLM...");
    try {
      const insights = await enrichWithLLM(ctx, provider);

      // Guard against blank LLM description — use fallback from scan data
      if (!insights.projectDescription || insights.projectDescription.trim() === "") {
        const langPart = ctx.primaryLanguage ? `${ctx.primaryLanguage} ` : "";
        const infraParts: string[] = [];
        if (ctx.infra.hasTerraform) infraParts.push("Terraform");
        if (ctx.infra.hasKubernetes) infraParts.push("Kubernetes");
        if (ctx.container.hasDockerfile) infraParts.push("Docker");
        insights.projectDescription =
          infraParts.length > 0
            ? `A ${langPart}project with ${infraParts.join(", ")} infrastructure.`
            : `A ${langPart}software project.`;
      }

      // Merge insights into context and re-write
      ctx.llmInsights = insights;
      fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2) + "\n");
      fs.writeFileSync(contextMdPath, formatContextMarkdown(ctx));

      if (!isStructured) enrichSpinner.stop("LLM analysis complete.");

      const insightLines = formatLLMInsights(insights);
      p.note(insightLines.join("\n"), "LLM project insights");
    } catch (err) {
      if (!isStructured) enrichSpinner.stop("LLM analysis failed.");
      p.log.warn(`LLM enrichment skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    p.log.info(`Run ${pc.cyan("dojops config")} to enable LLM-powered project analysis.`);
  }

  // Offer context review (interactive only)
  if (!cliCtx.globalOpts.nonInteractive) {
    const review = await p.confirm({
      message: "Review and edit the project context?",
      initialValue: false,
    });

    if (!p.isCancel(review) && review) {
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
      const editor = process.env.EDITOR || process.env.VISUAL;
      if (editor) {
        const editorParts = editor.split(/\s+/);
        const editorBinary = path.basename(editorParts[0]);
        if (!EDITOR_ALLOWLIST.includes(editorBinary)) {
          p.log.warn(
            `Editor ${pc.cyan(editorBinary)} is not in the allowed list (${EDITOR_ALLOWLIST.join(", ")}). Skipping.`,
          );
          p.log.info(`Edit the context file manually: ${pc.cyan(contextMdPath)}`);
        } else {
          p.log.info(`Opening ${pc.cyan(contextMdPath)} in ${pc.cyan(editor)}...`);
          try {
            execFileSync(editorParts[0], [...editorParts.slice(1), contextMdPath], {
              stdio: "inherit",
            });
            p.log.success("Context file updated.");
          } catch {
            p.log.warn(`Could not open editor. Edit manually: ${pc.dim(contextMdPath)}`);
          }
        }
      } else {
        p.log.info(`Edit the context file at: ${pc.cyan(contextMdPath)}`);
        p.log.info(`Set ${pc.cyan("$EDITOR")} to open it automatically next time.`);
      }
    }
  }

  p.log.info(`Context: ${pc.dim(contextMdPath)}`);

  // Offer to install missing optional tool dependencies (filtered by project domains)
  await offerToolInstall({
    nonInteractive: cliCtx.globalOpts.nonInteractive,
    domains: ctx.relevantDomains,
  });

  // Offer to install missing system tools (filtered by project domains)
  await offerSystemToolInstall({
    nonInteractive: cliCtx.globalOpts.nonInteractive,
    domains: ctx.relevantDomains,
  });
};
