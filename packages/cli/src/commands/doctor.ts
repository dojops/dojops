import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  ALL_SPECIALIST_CONFIGS,
  ToolDependency,
  SYSTEM_TOOLS,
  isToolSupportedOnCurrentPlatform,
} from "@dojops/core";
import { CLIContext } from "../types";
import { getConfigPath, resolveProvider, resolveOllamaHost } from "../config";
import { ExitCode } from "../exit-codes";
import { hasFlag } from "../parser";
import type { RepoContext } from "@dojops/core";
import {
  findProjectRoot,
  initProject,
  loadContext,
  listPlans,
  listExecutions,
  listScanReports,
  verifyAuditIntegrity,
} from "../state";
import {
  resolveBinary,
  resolveModule,
  offerToolInstall,
  offerSystemToolInstall,
  SYSTEM_TOOL_DOMAINS,
} from "../preflight";
import { loadToolchainRegistry, ensureToolchainDir } from "../toolchain-sandbox";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

function checkNodeVersion(): Check {
  const nodeVersion = process.versions.node;
  const major = Number.parseInt(nodeVersion.split(".")[0], 10);
  return {
    name: "Node.js version",
    status: major >= 18 ? "pass" : "fail",
    detail: `v${nodeVersion}${major < 18 ? " (requires >= 18)" : ""}`,
  };
}

function checkProvider(ctx: CLIContext): { check: Check; provider: string | undefined } {
  const provider = resolveProvider(ctx.globalOpts.provider, ctx.config);
  let providerSource: string;
  if (ctx.globalOpts.provider) providerSource = "(CLI flag)";
  else if (process.env.DOJOPS_PROVIDER) providerSource = "(env: DOJOPS_PROVIDER)";
  else if (ctx.config.defaultProvider) providerSource = "(config)";
  else providerSource = "(default)";
  return {
    check: {
      name: "Provider configured",
      status: provider ? "pass" : "warn",
      detail: `${provider} ${providerSource}`,
    },
    provider,
  };
}

function checkApiKey(provider: string, ctx: CLIContext): Check | undefined {
  if (!provider || provider === "ollama" || provider === "github-copilot") return undefined;

  const envVarMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const envVar = envVarMap[provider] ?? "OPENAI_API_KEY";
  const hasEnvKey = !!process.env[envVar];
  const hasConfigKey = !!ctx.config.tokens?.[provider];
  let detail: string;
  if (hasEnvKey) {
    detail = `Set via $${envVar}`;
  } else if (hasConfigKey) {
    detail = "Set in config";
  } else {
    detail = "Not found";
  }
  return {
    name: `API key (${provider})`,
    status: hasEnvKey || hasConfigKey ? "pass" : "fail",
    detail,
  };
}

async function checkCopilotAuth(provider: string | undefined): Promise<Check | undefined> {
  if (provider !== "github-copilot") return undefined;

  try {
    const { getValidCopilotToken } = await import("@dojops/core");
    const { apiBaseUrl } = await getValidCopilotToken();
    return { name: "Copilot API", status: "pass", detail: `Connected to ${apiBaseUrl}` };
  } catch (err) {
    return { name: "Copilot API", status: "fail", detail: (err as Error).message };
  }
}

function checkInitialization(): { check: Check; root: string | null } {
  const root = findProjectRoot();
  return {
    check: {
      name: "Project initialized (.dojops/)",
      status: root && fs.existsSync(`${root}/.dojops`) ? "pass" : "warn",
      detail: root ? `${root}/.dojops/` : "Not initialized (run: dojops init)",
    },
    root,
  };
}

async function checkOllama(
  provider: string | undefined,
  ctx: CLIContext,
): Promise<Check | undefined> {
  if (provider !== "ollama" && process.env.DOJOPS_PROVIDER !== "ollama") return undefined;

  const ollamaHost = resolveOllamaHost(undefined, ctx.config);
  let ollamaOk = false;
  try {
    const resp = await fetch(`${ollamaHost}/api/tags`);
    ollamaOk = resp.ok;
  } catch {
    // not reachable
  }
  return {
    name: "Ollama server",
    status: ollamaOk ? "pass" : "fail",
    detail: ollamaOk ? `Running at ${ollamaHost}` : `Not reachable at ${ollamaHost}`,
  };
}

function checkConfigPermissions(): Check | undefined {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return undefined;

  try {
    const stat = fs.statSync(configPath);
    const mode = (stat.mode & 0o777).toString(8);
    return {
      name: "Config file permissions",
      status: mode === "600" ? "pass" : "warn",
      detail: `${configPath} (${mode})`,
    };
  } catch {
    return { name: "Config file permissions", status: "warn", detail: "Could not check" };
  }
}

function checkBuiltInTools(projectDomains: string[]): Check[] {
  const domainSet = new Set(projectDomains);
  const seen = new Set<string>();
  const uniqueDeps: ToolDependency[] = [];
  for (const config of ALL_SPECIALIST_CONFIGS) {
    if (projectDomains.length > 0 && !domainSet.has(config.domain)) continue;
    for (const dep of config.toolDependencies ?? []) {
      if (!seen.has(dep.npmPackage)) {
        seen.add(dep.npmPackage);
        uniqueDeps.push(dep);
      }
    }
  }

  return uniqueDeps.map((dep) => {
    const found = dep.binary ? resolveBinary(dep.binary) : resolveModule(dep.npmPackage);
    return {
      name: `Tool: ${dep.name}`,
      status: found ? ("pass" as const) : ("warn" as const),
      detail: found ?? "Not found (optional)",
    };
  });
}

function resolveSystemToolStatus(
  tool: (typeof SYSTEM_TOOLS)[number],
  toolRegistry: ReturnType<typeof loadToolchainRegistry>,
): { status: "pass" | "warn"; detail: string } {
  const sandboxEntry = toolRegistry.tools.find((t) => t.name === tool.name);
  if (sandboxEntry) {
    return {
      status: "pass",
      detail: `Sandbox v${sandboxEntry.version} (${sandboxEntry.binaryPath})`,
    };
  }

  const systemBinary = resolveBinary(tool.binaryName);
  if (systemBinary) {
    return { status: "pass", detail: `System (${systemBinary})` };
  }

  if (isToolSupportedOnCurrentPlatform(tool)) {
    return { status: "warn", detail: `Not found — run: dojops toolchain install ${tool.name}` };
  }

  return { status: "warn", detail: "Unsupported on this platform" };
}

/**
 * Check if a system tool is actually needed by the project based on what was
 * detected in the scan — not just broad domain matching.
 * For example, `circleci` is only relevant if CircleCI CI was detected.
 */
function isToolRelevantToProject(toolName: string, repoCtx: RepoContext): boolean {
  const ciPlatforms = new Set(repoCtx.ci.map((c) => c.platform.toLowerCase()));
  const hasGitHub = [...ciPlatforms].some((p) => p.includes("github"));

  switch (toolName) {
    // CI-specific: only if that CI platform is detected
    case "actionlint":
      return hasGitHub;
    case "circleci":
      return ciPlatforms.has("circleci");
    case "gh":
      return hasGitHub || repoCtx.meta.isGitRepo;

    // Infrastructure: only if that IaC tool is detected
    case "terraform":
      return repoCtx.infra.hasTerraform;
    case "ansible":
      return repoCtx.infra.hasAnsible;

    // Container orchestration: only if K8s/Helm detected
    case "kubectl":
      return repoCtx.infra.hasKubernetes || repoCtx.infra.hasHelm;
    case "helm":
      return repoCtx.infra.hasHelm;

    // Container: only if Dockerfile detected
    case "hadolint":
      return repoCtx.container.hasDockerfile;

    // Scripts: only if shell scripts detected
    case "shellcheck":
      return repoCtx.scripts.shellScripts.length > 0;

    // Monitoring: only if Prometheus detected
    case "promtool":
      return repoCtx.monitoring.hasPrometheus;

    // Security tools: always relevant for any project
    case "trivy":
    case "gitleaks":
      return true;

    default:
      return true;
  }
}

function checkSystemTools(projectDomains: string[], repoCtx: RepoContext | null): Check[] {
  const domainSet = new Set(projectDomains);
  const toolRegistry = loadToolchainRegistry();
  const results: Check[] = [];

  for (const tool of SYSTEM_TOOLS) {
    const { status, detail } = resolveSystemToolStatus(tool, toolRegistry);

    // Always show installed tools, regardless of project relevance
    if (status === "pass") {
      results.push({ name: `System: ${tool.name}`, status, detail });
      continue;
    }

    // For non-installed tools, only show if relevant to project
    if (repoCtx) {
      if (!isToolRelevantToProject(tool.name, repoCtx)) continue;
    } else if (projectDomains.length > 0) {
      const toolDomains = SYSTEM_TOOL_DOMAINS[tool.name] ?? [];
      if (!toolDomains.some((d) => domainSet.has(d))) continue;
    }
    results.push({ name: `System: ${tool.name}`, status, detail });
  }

  return results;
}

function checkProjectMetrics(root: string | null): Check[] {
  if (!root || !fs.existsSync(`${root}/.dojops`)) return [];

  const plans = listPlans(root);
  const executions = listExecutions(root);
  const scanReports = listScanReports(root);
  const auditResult = verifyAuditIntegrity(root);

  const successCount = executions.filter((e) => e.status === "SUCCESS").length;
  const successRate =
    executions.length > 0 ? Math.round((successCount / executions.length) * 100) : 0;

  return [
    {
      name: "Plans",
      status: "pass",
      detail: `${plans.length} plan(s)`,
    },
    {
      name: "Executions",
      status: "pass",
      detail:
        executions.length > 0
          ? `${executions.length} execution(s) (${successRate}% success)`
          : "0 execution(s)",
    },
    {
      name: "Security scans",
      status: "pass",
      detail: `${scanReports.length} scan(s)`,
    },
    {
      name: "Audit chain",
      status: auditResult.valid ? "pass" : "fail",
      detail: auditResult.valid
        ? `Valid (${auditResult.totalEntries} entries)`
        : `Invalid — ${auditResult.errors.length} error(s) in ${auditResult.totalEntries} entries`,
    },
  ];
}

function formatChecks(checks: Check[]): string[] {
  const cols = Math.min(process.stdout.columns || 80, 100);
  const nameWidth = 26;
  const prefix = 4; // "  ✓ "
  const maxDetail = Math.max(20, cols - prefix - nameWidth - 6);

  return checks.map((c) => {
    const iconFail = c.status === "fail" ? pc.red("✗") : pc.yellow("!");
    const icon = c.status === "pass" ? pc.green("✓") : iconFail;
    const detail = c.detail.length > maxDetail ? c.detail.slice(0, maxDetail - 1) + "…" : c.detail;
    return `  ${icon} ${pc.bold(c.name.padEnd(nameWidth))} ${detail}`;
  });
}

/** Auto-fix config/project issues (no tool installs). */
function autoFixConfig(checks: Check[], ctx: CLIContext): number {
  let fixed = 0;

  // Fix: Create .dojops/ if missing
  const initCheck = checks.find((c) => c.name === "Project initialized (.dojops/)");
  if (initCheck?.status === "warn") {
    try {
      initProject(ctx.cwd);
      initCheck.status = "pass";
      initCheck.detail = `${ctx.cwd}/.dojops/ (created)`;
      p.log.success(`Fixed: Created .dojops/ in ${ctx.cwd}`);
      fixed++;
    } catch {
      // ignore — will remain as warning
    }
  }

  // Fix: Config file permissions (should be 0o600)
  const permCheck = checks.find((c) => c.name === "Config file permissions");
  if (permCheck?.status === "warn") {
    const configPath = getConfigPath();
    try {
      fs.chmodSync(configPath, 0o600); // NOSONAR
      permCheck.status = "pass";
      permCheck.detail = `${configPath} (600)`;
      p.log.success(`Fixed: Set config permissions to 600`);
      fixed++;
    } catch {
      // ignore — will remain as warning
    }
  }

  // Fix: Ensure toolchain directory exists
  try {
    ensureToolchainDir();
  } catch {
    // ignore
  }

  return fixed;
}

/** Auto-install all missing tools (npm + system) without prompting. */
async function autoFixTools(checks: Check[], projectDomains: string[]): Promise<number> {
  let fixed = 0;

  const hasMissingTools = checks.some((c) => c.name.startsWith("Tool:") && c.status === "warn");
  if (hasMissingTools) {
    const installed = await offerToolInstall({
      nonInteractive: false,
      domains: projectDomains,
      autoInstallAll: true,
    });
    fixed += installed.length;
  }

  const hasMissingSystemTools = checks.some(
    (c) => c.name.startsWith("System:") && c.status === "warn" && c.detail.includes("Not found"),
  );
  if (hasMissingSystemTools) {
    const installed = await offerSystemToolInstall({
      nonInteractive: false,
      domains: projectDomains,
      autoInstallAll: true,
    });
    fixed += installed.length;
  }

  return fixed;
}

async function collectAllChecks(
  ctx: CLIContext,
  projectDomains: string[],
  root: string | null,
  repoCtx: RepoContext | null,
): Promise<Check[]> {
  const { check: providerCheck, provider } = checkProvider(ctx);
  const { check: initCheck } = checkInitialization();
  const checks: Check[] = [checkNodeVersion(), providerCheck];

  const apiKeyCheck = checkApiKey(provider!, ctx);
  if (apiKeyCheck) checks.push(apiKeyCheck);

  const copilotCheck = await checkCopilotAuth(provider);
  if (copilotCheck) checks.push(copilotCheck);

  checks.push(initCheck);

  const ollamaCheck = await checkOllama(provider, ctx);
  if (ollamaCheck) checks.push(ollamaCheck);

  const configCheck = checkConfigPermissions();
  if (configCheck) checks.push(configCheck);

  checks.push(
    ...checkBuiltInTools(projectDomains),
    ...checkSystemTools(projectDomains, repoCtx),
    ...checkProjectMetrics(root),
  );

  return checks;
}

function reportCheckSummary(checks: Check[]): { failCount: number; warnCount: number } {
  p.note(formatChecks(checks).join("\n"), "System Diagnostics");
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  if (failCount === 0 && warnCount === 0) {
    p.log.success("All checks passed.");
  } else if (failCount > 0) {
    p.log.error(`${failCount} check(s) failed, ${warnCount} warning(s).`);
  } else {
    p.log.warn(`${warnCount} warning(s).`);
  }
  return { failCount, warnCount };
}

async function handleFixMode(
  checks: Check[],
  ctx: CLIContext,
  projectDomains: string[],
  fixMode: boolean,
): Promise<void> {
  if (fixMode) {
    const configFixed = autoFixConfig(checks, ctx);
    const toolsFixed = await autoFixTools(checks, projectDomains);
    const totalFixed = configFixed + toolsFixed;
    if (totalFixed > 0) {
      p.log.success(`${totalFixed} issue(s) auto-fixed.`);
    } else {
      p.log.info("No auto-fixable issues found.");
    }
    return;
  }

  const hasMissingTools = checks.some((c) => c.name.startsWith("Tool:") && c.status === "warn");
  if (hasMissingTools) {
    await offerToolInstall({
      nonInteractive: ctx.globalOpts.nonInteractive,
      domains: projectDomains,
    });
  }

  const hasMissingSystemTools = checks.some(
    (c) => c.name.startsWith("System:") && c.status === "warn" && c.detail.includes("Not found"),
  );
  if (hasMissingSystemTools) {
    await offerSystemToolInstall({
      nonInteractive: ctx.globalOpts.nonInteractive,
      domains: projectDomains,
    });
  }
}

export async function statusCommand(_args: string[], ctx: CLIContext): Promise<void> {
  const fixMode = hasFlag(_args, "--fix");
  const { root } = checkInitialization();
  const repoCtx = root ? loadContext(root) : null;
  const projectDomains: string[] = repoCtx?.relevantDomains ?? [];
  const checks = await collectAllChecks(ctx, projectDomains, root, repoCtx);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ checks }, null, 2));
    return;
  }

  const { failCount } = reportCheckSummary(checks);
  await handleFixMode(checks, ctx, projectDomains, fixMode);

  if (failCount > 0) {
    process.exit(ExitCode.GENERAL_ERROR);
  }
}
