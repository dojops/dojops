import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { maskToken } from "../formatter";
import { getConfigPath, resolveProvider } from "../config";
import { findProjectRoot, loadSession } from "../state";
import { ExitCode, CLIError } from "../exit-codes";

export async function inspectCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "config":
      return inspectConfig(ctx);
    case "session":
      return inspectSession(ctx);
    default:
      if (!sub) {
        p.log.info(`  ${pc.dim("$")} dojops inspect config`);
        p.log.info(`  ${pc.dim("$")} dojops inspect session`);
        throw new CLIError(
          ExitCode.VALIDATION_ERROR,
          "No inspect target specified. Available: config, session",
        );
      }
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Unknown inspect target: "${sub}". Available: config, session`,
      );
  }
}

function inspectConfig(ctx: CLIContext): void {
  const config = ctx.config;
  if (ctx.globalOpts.output === "json") {
    const safeConfig = {
      ...config,
      tokens: Object.fromEntries(
        Object.entries(config.tokens ?? {}).map(([k, v]) => [k, v ? "***" : null]),
      ),
    };
    console.log(JSON.stringify(safeConfig, null, 2));
    return;
  }

  // UX #2: Show effective provider including env var
  const effectiveProvider = resolveProvider(undefined, config);
  const providerDisplay =
    process.env.DOJOPS_PROVIDER && process.env.DOJOPS_PROVIDER !== config.defaultProvider
      ? `${effectiveProvider} ${pc.dim(`(env: DOJOPS_PROVIDER=${process.env.DOJOPS_PROVIDER})`)}`
      : effectiveProvider;
  const lines = [
    `${pc.bold("Provider:")}  ${providerDisplay}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:    ${maskToken(config.tokens?.openai)}`,
    `  anthropic: ${maskToken(config.tokens?.anthropic)}`,
    `  deepseek:  ${maskToken(config.tokens?.deepseek)}`,
    `  gemini:    ${maskToken(config.tokens?.gemini)}`,
    `  ollama:    ${pc.dim("(no token needed)")}`,
    `${pc.bold("Config:")}    ${pc.dim(getConfigPath())}`,
  ];
  p.note(lines.join("\n"), "Resolved Configuration");
}

function inspectSession(ctx: CLIContext): void {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
    return;
  }

  const session = loadSession(root);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  const lines = [
    `${pc.bold("Mode:")}        ${session.mode}`,
    `${pc.bold("Current Plan:")} ${session.currentPlan ?? pc.dim("(none)")}`,
    `${pc.bold("Last Agent:")}  ${session.lastAgent ?? pc.dim("(none)")}`,
    `${pc.bold("Risk Level:")}  ${session.riskLevel ?? pc.dim("(none)")}`,
    `${pc.bold("Updated:")}     ${session.updatedAt}`,
  ];
  p.note(lines.join("\n"), "Session State");
}
