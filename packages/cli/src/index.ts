#!/usr/bin/env node

// Suppress punycode deprecation warning from transitive dependencies (openai -> tr46 -> whatwg-url)
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
  if (typeof warning === "string" && warning.includes("punycode")) return;
  if (warning instanceof Error && warning.message.includes("punycode")) return;
  (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...args);
};

import "dotenv/config";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { createProvider } from "@odaops/api";
import { LLMProvider } from "@odaops/core";
import { resolveProvider, resolveModel, resolveToken, loadProfileConfig } from "./config";
import { parseGlobalOptions, parseCommandPath } from "./parser";
import { remapLegacyArgs } from "./compat";
import { printHelp } from "./help";
import { resolveCommand } from "./commands";
import { CLIContext } from "./types";
import { ExitCode } from "./exit-codes";

// ── Late-registered commands (Phases 2-6) ──────────────────────────
import { registerCommand, registerSubcommand } from "./commands";
import { initCommand } from "./commands/init";
import { applyCommand } from "./commands/apply";
import { validateCommand } from "./commands/validate";
import { destroyCommand } from "./commands/destroy";
import { rollbackCommand } from "./commands/rollback";
import { explainCommand } from "./commands/explain";
import { inspectCommand } from "./commands/inspect";
import { agentsCommand } from "./commands/agents";
import { historyCommand } from "./commands/history";
import { doctorCommand } from "./commands/doctor";

registerCommand("init", initCommand);
registerCommand("apply", applyCommand);
registerCommand("validate", validateCommand);
registerCommand("destroy", destroyCommand);
registerCommand("rollback", rollbackCommand);
registerCommand("explain", explainCommand);
registerCommand("doctor", doctorCommand);

// Nested: inspect <sub>, agents <sub>, history <sub>
registerSubcommand("inspect", "config", inspectCommand);
registerSubcommand("inspect", "policy", inspectCommand);
registerSubcommand("inspect", "agents", inspectCommand);
registerSubcommand("inspect", "session", inspectCommand);
registerSubcommand("agents", "list", agentsCommand);
registerSubcommand("agents", "info", agentsCommand);
registerSubcommand("history", "list", historyCommand);
registerSubcommand("history", "show", historyCommand);
registerSubcommand("history", "verify", historyCommand);
registerSubcommand("history", "rollback", historyCommand);

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);

  // Help / version early returns
  if (rawArgs.includes("--help") || rawArgs.includes("-h") || rawArgs.length === 0) {
    printHelp();
    process.exit(rawArgs.length === 0 ? 1 : 0);
  }

  // Parse global options first
  const { globalOpts, remaining } = parseGlobalOptions(rawArgs);

  // Handle --no-color
  if (globalOpts.noColor) {
    process.env.NO_COLOR = "1";
  }

  // Backward compatibility remapping
  const remapped = remapLegacyArgs(remaining);

  // Parse command path
  const { command, positional } = parseCommandPath(remapped);

  // Resolve command handler
  const resolved = resolveCommand(command, positional);

  // Load config (with profile support)
  const config = loadProfileConfig(globalOpts.profile);

  // Build CLIContext with lazy provider
  let cachedProvider: LLMProvider | undefined;
  const ctx: CLIContext = {
    globalOpts,
    config,
    cwd: process.cwd(),
    getProvider() {
      if (cachedProvider) return cachedProvider;

      let providerName: string;
      try {
        providerName = resolveProvider(globalOpts.provider, config);
      } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
      }

      const model = resolveModel(globalOpts.model, config);
      const apiKey = resolveToken(providerName, config);

      cachedProvider = createProvider({ provider: providerName, model, apiKey });
      return cachedProvider;
    },
  };

  // Non-LLM commands: config, auth, serve, init, doctor — no intro banner
  const quietCommands = new Set(["config", "auth", "init", "doctor"]);
  const isQuiet = command.length > 0 && quietCommands.has(command[0]);

  if (!isQuiet && !globalOpts.quiet) {
    p.intro(pc.bgCyan(pc.black(" oda ")));
  }

  try {
    if (resolved) {
      await resolved.handler(resolved.remaining, ctx);
    } else {
      // Default: generate command (oda "prompt")
      const { generateCommand } = await import("./commands/generate");
      await generateCommand(remapped, ctx);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    p.log.error(msg);
    if (globalOpts.debug) {
      console.error(err);
    }
    process.exit(ExitCode.GENERAL_ERROR);
  }

  if (!isQuiet && !globalOpts.quiet) {
    p.outro("Done.");
  }
}

main();
