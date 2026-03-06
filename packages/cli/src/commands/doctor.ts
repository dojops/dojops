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
import {
  findProjectRoot,
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
import { loadToolchainRegistry } from "../toolchain-sandbox";

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

function checkSystemTools(projectDomains: string[]): Check[] {
  const domainSet = new Set(projectDomains);
  const toolRegistry = loadToolchainRegistry();
  const results: Check[] = [];

  for (const tool of SYSTEM_TOOLS) {
    if (projectDomains.length > 0) {
      const toolDomains = SYSTEM_TOOL_DOMAINS[tool.name] ?? [];
      if (!toolDomains.some((d) => domainSet.has(d))) continue;
    }
    const { status, detail } = resolveSystemToolStatus(tool, toolRegistry);
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

export async function statusCommand(_args: string[], ctx: CLIContext): Promise<void> {
  // Run all checks
  const { check: providerCheck, provider } = checkProvider(ctx);
  const { check: initCheck, root } = checkInitialization();
  const projectDomains: string[] = root ? (loadContext(root)?.relevantDomains ?? []) : [];

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

  checks.push(...checkBuiltInTools(projectDomains));
  checks.push(...checkSystemTools(projectDomains));
  checks.push(...checkProjectMetrics(root));

  // Output
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ checks }, null, 2));
    return;
  }

  p.note(formatChecks(checks).join("\n"), "System Diagnostics");

  const failCount = checks.filter((c) => c.status === "fail").length;
  if (failCount > 0) {
    p.log.error(`${failCount} check(s) failed.`);
    // Exit non-zero after offering tool installs below
  } else {
    p.log.success("All checks passed.");
  }

  // Offer to install missing optional tool dependencies (filtered by project domains)
  const hasMissingTools = checks.some((c) => c.name.startsWith("Tool:") && c.status === "warn");
  if (hasMissingTools) {
    await offerToolInstall({
      nonInteractive: ctx.globalOpts.nonInteractive,
      domains: projectDomains,
    });
  }

  // Offer to install missing system tools (filtered by project domains)
  const hasMissingSystemTools = checks.some(
    (c) => c.name.startsWith("System:") && c.status === "warn" && c.detail.includes("Not found"),
  );
  if (hasMissingSystemTools) {
    await offerSystemToolInstall({
      nonInteractive: ctx.globalOpts.nonInteractive,
      domains: projectDomains,
    });
  }

  // Exit non-zero when checks failed
  if (failCount > 0) {
    process.exit(ExitCode.GENERAL_ERROR);
  }
}
