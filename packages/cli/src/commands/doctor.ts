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

export async function statusCommand(_args: string[], ctx: CLIContext): Promise<void> {
  const checks: Check[] = [];

  // Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  checks.push({
    name: "Node.js version",
    status: major >= 18 ? "pass" : "fail",
    detail: `v${nodeVersion}${major < 18 ? " (requires >= 18)" : ""}`,
  });

  // Provider configured — UX #1: use resolveProvider() to include DOJOPS_PROVIDER env var
  const provider = resolveProvider(ctx.globalOpts.provider, ctx.config);
  const providerSource = ctx.globalOpts.provider
    ? "(CLI flag)"
    : process.env.DOJOPS_PROVIDER
      ? "(env: DOJOPS_PROVIDER)"
      : ctx.config.defaultProvider
        ? "(config)"
        : "(default)";
  checks.push({
    name: "Provider configured",
    status: provider ? "pass" : "warn",
    detail: `${provider} ${providerSource}`,
  });

  // API key present
  if (provider && provider !== "ollama" && provider !== "github-copilot") {
    const envVarMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      deepseek: "DEEPSEEK_API_KEY",
      gemini: "GEMINI_API_KEY",
    };
    const envVar = envVarMap[provider] ?? "OPENAI_API_KEY";
    const hasEnvKey = !!process.env[envVar];
    const hasConfigKey = !!ctx.config.tokens?.[provider];
    checks.push({
      name: `API key (${provider})`,
      status: hasEnvKey || hasConfigKey ? "pass" : "fail",
      detail: hasEnvKey ? `Set via $${envVar}` : hasConfigKey ? "Set in config" : "Not found",
    });
  }

  // GitHub Copilot auth check
  if (provider === "github-copilot") {
    try {
      const { getValidCopilotToken } = await import("@dojops/core");
      const { apiBaseUrl } = await getValidCopilotToken();
      checks.push({
        name: "Copilot API",
        status: "pass",
        detail: `Connected to ${apiBaseUrl}`,
      });
    } catch (err) {
      checks.push({
        name: "Copilot API",
        status: "fail",
        detail: (err as Error).message,
      });
    }
  }

  // .dojops/ initialized
  const root = findProjectRoot();
  checks.push({
    name: "Project initialized (.dojops/)",
    status: root && fs.existsSync(`${root}/.dojops`) ? "pass" : "warn",
    detail: root ? `${root}/.dojops/` : "Not initialized (run: dojops init)",
  });

  // Load project domains for filtering tool suggestions
  const projectDomains: string[] = root ? (loadContext(root)?.relevantDomains ?? []) : [];

  // Ollama reachability
  if (provider === "ollama" || process.env.DOJOPS_PROVIDER === "ollama") {
    const ollamaHost = resolveOllamaHost(undefined, ctx.config);
    let ollamaOk = false;
    try {
      const resp = await fetch(`${ollamaHost}/api/tags`);
      ollamaOk = resp.ok;
    } catch {
      // not reachable
    }
    checks.push({
      name: "Ollama server",
      status: ollamaOk ? "pass" : "fail",
      detail: ollamaOk ? `Running at ${ollamaHost}` : `Not reachable at ${ollamaHost}`,
    });
  }

  // Config file permissions
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    try {
      const stat = fs.statSync(configPath);
      const mode = (stat.mode & 0o777).toString(8);
      checks.push({
        name: "Config file permissions",
        status: mode === "600" ? "pass" : "warn",
        detail: `${configPath} (${mode})`,
      });
    } catch {
      checks.push({
        name: "Config file permissions",
        status: "warn",
        detail: "Could not check",
      });
    }
  }

  // Agent tool dependencies (deduplicated by npmPackage, filtered by project domains)
  const domainSet = new Set(projectDomains);
  const seen = new Set<string>();
  const uniqueDeps: ToolDependency[] = [];
  for (const config of ALL_SPECIALIST_CONFIGS) {
    // Skip specialists whose domain doesn't match the project (if domains are known)
    if (projectDomains.length > 0 && !domainSet.has(config.domain)) continue;
    for (const dep of config.toolDependencies ?? []) {
      if (!seen.has(dep.npmPackage)) {
        seen.add(dep.npmPackage);
        uniqueDeps.push(dep);
      }
    }
  }
  for (const dep of uniqueDeps) {
    const found = dep.binary ? resolveBinary(dep.binary) : resolveModule(dep.npmPackage);
    checks.push({
      name: `Tool: ${dep.name}`,
      status: found ? "pass" : "warn",
      detail: found ?? "Not found (optional)",
    });
  }

  // System tool checks (filtered by project domains)
  const toolRegistry = loadToolchainRegistry();
  for (const tool of SYSTEM_TOOLS) {
    // Skip system tools whose domains don't match the project (if domains are known)
    if (projectDomains.length > 0) {
      const toolDomains = SYSTEM_TOOL_DOMAINS[tool.name] ?? [];
      if (!toolDomains.some((d) => domainSet.has(d))) continue;
    }
    const sandboxEntry = toolRegistry.tools.find((t) => t.name === tool.name);
    const systemBinary = !sandboxEntry ? resolveBinary(tool.binaryName) : undefined;
    const supported = isToolSupportedOnCurrentPlatform(tool);

    let status: "pass" | "warn";
    let detail: string;
    if (sandboxEntry) {
      status = "pass";
      detail = `Sandbox v${sandboxEntry.version} (${sandboxEntry.binaryPath})`;
    } else if (systemBinary) {
      status = "pass";
      detail = `System (${systemBinary})`;
    } else if (!supported) {
      status = "warn";
      detail = "Unsupported on this platform";
    } else {
      status = "warn";
      detail = `Not found — run: dojops toolchain install ${tool.name}`;
    }

    checks.push({ name: `System: ${tool.name}`, status, detail });
  }

  // Project metrics summary
  if (root && fs.existsSync(`${root}/.dojops`)) {
    const plans = listPlans(root);
    const executions = listExecutions(root);
    const scanReports = listScanReports(root);
    const auditResult = verifyAuditIntegrity(root);

    const successCount = executions.filter((e) => e.status === "SUCCESS").length;
    const successRate =
      executions.length > 0 ? Math.round((successCount / executions.length) * 100) : 0;

    checks.push({
      name: "Plans",
      status: "pass",
      detail: `${plans.length} plan(s)`,
    });
    checks.push({
      name: "Executions",
      status: "pass",
      detail:
        executions.length > 0
          ? `${executions.length} execution(s) (${successRate}% success)`
          : "0 execution(s)",
    });
    checks.push({
      name: "Security scans",
      status: "pass",
      detail: `${scanReports.length} scan(s)`,
    });
    checks.push({
      name: "Audit chain",
      status: auditResult.valid ? "pass" : "fail",
      detail: auditResult.valid
        ? `Valid (${auditResult.totalEntries} entries)`
        : `Invalid — ${auditResult.errors.length} error(s) in ${auditResult.totalEntries} entries`,
    });
  }

  // Output
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ checks }, null, 2));
    return;
  }

  const cols = Math.min(process.stdout.columns || 80, 100);
  const nameWidth = 26;
  const prefix = 4; // "  ✓ "
  const maxDetail = Math.max(20, cols - prefix - nameWidth - 6);

  const lines = checks.map((c) => {
    const icon =
      c.status === "pass" ? pc.green("✓") : c.status === "fail" ? pc.red("✗") : pc.yellow("!");
    const detail = c.detail.length > maxDetail ? c.detail.slice(0, maxDetail - 1) + "…" : c.detail;
    return `  ${icon} ${pc.bold(c.name.padEnd(nameWidth))} ${detail}`;
  });

  p.note(lines.join("\n"), "System Diagnostics");

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
