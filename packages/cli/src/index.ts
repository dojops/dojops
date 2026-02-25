#!/usr/bin/env node

// Suppress punycode deprecation warning from transitive dependencies (openai -> tr46 -> whatwg-url)
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
  if (typeof warning === "string" && warning.includes("punycode")) return;
  if (warning instanceof Error && warning.message.includes("punycode")) return;
  (originalEmitWarning as (...a: unknown[]) => void).call(process, warning, ...args);
};

import "dotenv/config";
import * as p from "@clack/prompts";
import { createProvider } from "@dojops/api";
import { LLMProvider } from "@dojops/core";
import { resolveProvider, resolveModel, resolveToken, loadProfileConfig } from "./config";
import { parseGlobalOptions, parseCommandPath } from "./parser";
import { remapLegacyArgs } from "./compat";
import { printHelp, printCommandHelp, printBanner } from "./help";
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
import { statusCommand } from "./commands/doctor";
import {
  toolsListCommand,
  toolsLoadCommand,
  toolsInstallCommand,
  toolsRemoveCommand,
  toolsCleanCommand,
  toolsPluginsCommand,
} from "./commands/tools";
import { scanCommand } from "./commands/scan";
import { chatCommand } from "./commands/chat";
import { checkCommand } from "./commands/check";
import { prependToolsBinToPath } from "./tool-sandbox";

registerCommand("init", initCommand);
registerCommand("apply", applyCommand);
registerCommand("validate", validateCommand);
registerCommand("destroy", destroyCommand);
registerCommand("rollback", rollbackCommand);
registerCommand("explain", explainCommand);
registerCommand("status", statusCommand);
registerCommand("doctor", statusCommand); // backward compat alias
registerCommand("scan", scanCommand);
registerCommand("chat", chatCommand);
registerCommand("check", checkCommand);

// Nested: inspect <sub>, agents <sub>, history <sub>
// Agents/history handlers use an internal dispatcher that expects args[0] to be the subcommand.
// Since resolveCommand strips the subcommand from args, we wrap each registration to prepend it.
registerCommand("inspect", inspectCommand);
registerSubcommand("agents", "list", (args, ctx) => agentsCommand(["list", ...args], ctx));
registerSubcommand("agents", "info", (args, ctx) => agentsCommand(["info", ...args], ctx));
registerSubcommand("agents", "create", (args, ctx) => agentsCommand(["create", ...args], ctx));
registerSubcommand("agents", "remove", (args, ctx) => agentsCommand(["remove", ...args], ctx));
registerSubcommand("history", "list", (args, ctx) => historyCommand(["list", ...args], ctx));
registerSubcommand("history", "show", (args, ctx) => historyCommand(["show", ...args], ctx));
registerSubcommand("history", "verify", (args, ctx) => historyCommand(["verify", ...args], ctx));

// Nested: tools <sub>
registerSubcommand("tools", "list", toolsListCommand);
registerSubcommand("tools", "load", toolsLoadCommand);
registerSubcommand("tools", "install", toolsInstallCommand);
registerSubcommand("tools", "remove", toolsRemoveCommand);
registerSubcommand("tools", "clean", toolsCleanCommand);
registerSubcommand("tools", "plugins", toolsPluginsCommand);

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  // Prepend sandbox tools to PATH so they are found by all commands
  prependToolsBinToPath();

  const rawArgs = process.argv.slice(2);

  // No args → global help
  if (rawArgs.length === 0) {
    printHelp();
    process.exit(1);
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

  // Help flag: show per-command or global help
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    if (command.length > 0) {
      printCommandHelp(command.join(" "));
    } else {
      printHelp();
    }
    process.exit(0);
  }

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
        process.exit(ExitCode.VALIDATION_ERROR);
      }

      const model = resolveModel(globalOpts.model, config);
      const apiKey = resolveToken(providerName, config);

      cachedProvider = createProvider({ provider: providerName, model, apiKey });
      return cachedProvider;
    },
  };

  // Non-LLM commands: config, auth, serve, init, doctor — no intro banner
  const quietCommands = new Set([
    "config",
    "auth",
    "init",
    "doctor",
    "status",
    "tools",
    "scan",
    "chat",
    "check",
    "agents",
    "history",
  ]);
  const isQuiet = command.length > 0 && quietCommands.has(command[0]);

  if (!isQuiet && !globalOpts.quiet && globalOpts.output !== "json") {
    printBanner();
  }

  try {
    if (resolved) {
      await resolved.handler(resolved.remaining, ctx);
    } else {
      // Default: generate command (dojops "prompt")
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

  if (!isQuiet && !globalOpts.quiet && globalOpts.output !== "json") {
    p.outro("Done.");
  }
}

main();
