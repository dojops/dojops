import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { scanRepo, enrichWithLLM } from "@odaops/core";
import type { RepoContext, LLMInsights } from "@odaops/core";
import { CommandHandler } from "../types";
import { initProject, findProjectRoot } from "../state";
import { offerToolInstall } from "../preflight";

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
  if (infraParts.length > 0) {
    lines.push(`${pc.cyan("Infra:")}         ${infraParts.join(", ")}`);
  }

  // Monitoring
  const monParts: string[] = [];
  if (ctx.monitoring.hasPrometheus) monParts.push("Prometheus");
  if (ctx.monitoring.hasNginx) monParts.push("Nginx");
  if (ctx.monitoring.hasSystemd) monParts.push("Systemd");
  if (monParts.length > 0) {
    lines.push(`${pc.cyan("Monitoring:")}    ${monParts.join(", ")}`);
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

  lines.push(`${pc.cyan("Description:")}   ${insights.projectDescription}`);
  lines.push("");

  if (insights.techStack.length > 0) {
    lines.push(`${pc.cyan("Tech stack:")}    ${insights.techStack.join(", ")}`);
  }

  if (insights.suggestedWorkflows.length > 0) {
    lines.push("");
    lines.push(`${pc.cyan("Suggested workflows:")}`);
    for (const wf of insights.suggestedWorkflows) {
      lines.push(`  ${pc.green("$")} ${wf.command}`);
      lines.push(`    ${pc.dim(wf.description)}`);
    }
  }

  if (insights.recommendedAgents.length > 0) {
    lines.push("");
    lines.push(`${pc.cyan("Recommended agents:")} ${insights.recommendedAgents.join(", ")}`);
  }

  if (insights.notes) {
    lines.push("");
    lines.push(`${pc.cyan("Notes:")}         ${insights.notes}`);
  }

  return lines;
}

export const initCommand: CommandHandler = async (_args, cliCtx) => {
  const root = findProjectRoot() ?? process.cwd();
  const alreadyExists = fs.existsSync(path.join(root, ".oda"));
  const created = initProject(root);

  // Scan the repository
  const s = p.spinner();
  s.start("Scanning repository...");
  const ctx = scanRepo(root);
  const contextPath = path.join(root, ".oda", "context.json");
  fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2) + "\n");
  s.stop("Repository scanned.");

  if (alreadyExists && created.length === 0) {
    p.log.info("Project already initialized — context updated.");
    p.log.info(`  ${pc.dim(contextPath)}`);
  } else {
    const lines = created.map((f) => `  ${pc.green("+")} ${f}`);
    lines.push(`  ${pc.green("+")} .oda/context.json`);
    p.note(lines.join("\n"), `Initialized .oda/ in ${pc.dim(root)}`);
    p.log.success("Project initialized.");
  }

  // Display scan summary
  const summaryLines = formatScanSummary(ctx);
  p.note(summaryLines.join("\n"), "Repo scan results");

  // LLM enrichment (optional — only if a provider is configured)
  let provider;
  try {
    provider = cliCtx.getProvider();
  } catch {
    // No provider configured — that's fine
  }

  if (provider) {
    const enrichSpinner = p.spinner();
    enrichSpinner.start("Analyzing project with LLM...");
    try {
      const insights = await enrichWithLLM(ctx, provider);

      // Merge insights into context and re-write
      ctx.llmInsights = insights;
      fs.writeFileSync(contextPath, JSON.stringify(ctx, null, 2) + "\n");

      enrichSpinner.stop("LLM analysis complete.");

      const insightLines = formatLLMInsights(insights);
      p.note(insightLines.join("\n"), "LLM project insights");
    } catch (err) {
      enrichSpinner.stop("LLM analysis failed.");
      p.log.warn(`LLM enrichment skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    p.log.info(`Run ${pc.cyan("oda config")} to enable LLM-powered project analysis.`);
  }

  // Offer to install missing optional tool dependencies
  await offerToolInstall({ nonInteractive: cliCtx.globalOpts.nonInteractive });
};
