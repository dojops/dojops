import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { getConfigPath } from "../config";
import { findProjectRoot } from "../state";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

export async function doctorCommand(_args: string[], ctx: CLIContext): Promise<void> {
  const checks: Check[] = [];

  // Node.js version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  checks.push({
    name: "Node.js version",
    status: major >= 18 ? "pass" : "fail",
    detail: `v${nodeVersion}${major < 18 ? " (requires >= 18)" : ""}`,
  });

  // Provider configured
  const provider = ctx.config.defaultProvider;
  checks.push({
    name: "Provider configured",
    status: provider ? "pass" : "warn",
    detail: provider ?? "Not set (defaults to openai)",
  });

  // API key present
  if (provider && provider !== "ollama") {
    const envVar = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const hasEnvKey = !!process.env[envVar];
    const hasConfigKey = !!ctx.config.tokens?.[provider];
    checks.push({
      name: `API key (${provider})`,
      status: hasEnvKey || hasConfigKey ? "pass" : "fail",
      detail: hasEnvKey ? `Set via $${envVar}` : hasConfigKey ? "Set in config" : "Not found",
    });
  }

  // .oda/ initialized
  const root = findProjectRoot();
  checks.push({
    name: "Project initialized (.oda/)",
    status: root && fs.existsSync(`${root}/.oda`) ? "pass" : "warn",
    detail: root ? `${root}/.oda/` : "Not initialized (run: oda init)",
  });

  // Ollama reachability
  if (provider === "ollama" || process.env.ODA_PROVIDER === "ollama") {
    let ollamaOk = false;
    try {
      const resp = await fetch("http://localhost:11434/api/tags");
      ollamaOk = resp.ok;
    } catch {
      // not reachable
    }
    checks.push({
      name: "Ollama server",
      status: ollamaOk ? "pass" : "fail",
      detail: ollamaOk ? "Running at localhost:11434" : "Not reachable",
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

  // Output
  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ checks }, null, 2));
    return;
  }

  const lines = checks.map((c) => {
    const icon =
      c.status === "pass" ? pc.green("✓") : c.status === "fail" ? pc.red("✗") : pc.yellow("!");
    return `  ${icon} ${pc.bold(c.name.padEnd(28))} ${c.detail}`;
  });

  p.note(lines.join("\n"), "System Diagnostics");

  const failCount = checks.filter((c) => c.status === "fail").length;
  if (failCount > 0) {
    p.log.error(`${failCount} check(s) failed.`);
  } else {
    p.log.success("All checks passed.");
  }
}
