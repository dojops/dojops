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
import { createProvider } from "@dojops/api";
import { LLMProvider } from "@dojops/core";
import { resolveProvider, resolveModel, resolveToken, loadProfileConfig } from "./config";
import { parseGlobalOptions, parseCommandPath } from "./parser";
import { remapLegacyArgs } from "./compat";
import { printHelp, printCommandHelp, printBanner } from "./help";
import { resolveCommand } from "./commands";
import { CLIContext } from "./types";
import { ExitCode, CLIError } from "./exit-codes";
import { getDojopsVersion } from "./state";

// ── Late-registered commands (Phases 2-6) ──────────────────────────
import { registerCommand, registerSubcommand } from "./commands";
import { initCommand } from "./commands/init";
import { applyCommand } from "./commands/apply";
import { validateCommand } from "./commands/validate";
import { cleanCommand } from "./commands/destroy";
import { rollbackCommand } from "./commands/rollback";
import { explainCommand } from "./commands/explain";
import { inspectCommand } from "./commands/inspect";
import { agentsCommand } from "./commands/agents";
import { historyCommand } from "./commands/history";
import { statusCommand } from "./commands/doctor";
import {
  toolsListCommand,
  toolsInitCommand,
  toolsValidateCommand,
  toolsLoadCommand,
} from "./commands/tools";
import {
  toolchainListCommand,
  toolchainLoadCommand,
  toolchainInstallCommand,
  toolchainRemoveCommand,
  toolchainCleanCommand,
} from "./commands/toolchain";
import { scanCommand } from "./commands/scan";
import { chatCommand } from "./commands/chat";
import { checkCommand } from "./commands/check";
import { verifyCommand } from "./commands/verify";
import { providerCommand } from "./commands/provider";
import { prependToolchainBinToPath } from "./toolchain-sandbox";

registerCommand("init", initCommand);
registerCommand("apply", applyCommand);
registerCommand("validate", validateCommand);
registerCommand("clean", cleanCommand);
registerCommand("destroy", (args, ctx) => cleanCommand(args, ctx, true));
registerCommand("rollback", rollbackCommand);
registerCommand("explain", explainCommand);
registerCommand("status", statusCommand);
registerCommand("doctor", statusCommand); // backward compat alias
registerCommand("scan", scanCommand);
registerCommand("chat", chatCommand);
registerCommand("check", checkCommand);
registerCommand("verify", verifyCommand);

// `dojops help <command>` → show per-command help
registerCommand("help", async (args) => {
  const subCommand = args[0];
  if (subCommand) {
    printCommandHelp(subCommand);
  } else {
    printHelp();
  }
});

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
registerSubcommand("history", "audit", (args, ctx) => historyCommand(["audit", ...args], ctx));
registerCommand("provider", providerCommand);

// Nested: tools <sub> (manifest-based custom tools)
registerSubcommand("tools", "list", toolsListCommand);
registerSubcommand("tools", "init", toolsInitCommand);
registerSubcommand("tools", "validate", toolsValidateCommand);
registerSubcommand("tools", "load", toolsLoadCommand);

// Nested: toolchain <sub> (system binaries)
registerSubcommand("toolchain", "list", toolchainListCommand);
registerSubcommand("toolchain", "load", toolchainLoadCommand);
registerSubcommand("toolchain", "install", toolchainInstallCommand);
registerSubcommand("toolchain", "remove", toolchainRemoveCommand);
registerSubcommand("toolchain", "clean", toolchainCleanCommand);

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  // Prepend toolchain bin to PATH so they are found by all commands
  prependToolchainBinToPath();

  // CI auto-detection: force non-interactive mode and suppress banner in CI environments
  const isCI = !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL ||
    process.env.CIRCLECI ||
    process.env.TF_BUILD
  );

  const rawArgs = process.argv.slice(2);

  // No args → global help
  if (rawArgs.length === 0) {
    printHelp();
    process.exit(0);
  }

  // --version / -V
  if (rawArgs.includes("--version") || rawArgs.includes("-V")) {
    console.log(`dojops v${getDojopsVersion()}`);
    process.exit(0);
  }

  // Parse global options first
  const { globalOpts, remaining } = parseGlobalOptions(rawArgs);

  // In CI or non-TTY, force non-interactive mode and suppress color
  if (isCI || !process.stdout.isTTY) {
    globalOpts.nonInteractive = true;
    if (!process.stdout.isTTY) {
      process.env.NO_COLOR = "1";
    }
  }

  // When --non-interactive is explicitly set, suppress ANSI even on TTY
  if (globalOpts.nonInteractive && !process.env.NO_COLOR) {
    process.env.NO_COLOR = "1";
  }

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
        throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
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
    "provider",
    "init",
    "doctor",
    "status",
    "tools",
    "toolchain",
    "scan",
    "chat",
    "check",
    "verify",
    "agents",
    "history",
    "serve",
    "help",
  ]);
  const isQuiet = command.length > 0 && quietCommands.has(command[0]);

  if (!isQuiet && !isCI && !globalOpts.quiet && globalOpts.output !== "json") {
    printBanner();
  }

  // Known parent commands that have subcommands (used for better error messages)
  const NESTED_COMMAND_PARENTS = new Set([
    "debug",
    "analyze",
    "agents",
    "history",
    "tools",
    "toolchain",
    "inspect",
    "scan",
  ]);

  try {
    if (resolved) {
      await resolved.handler(resolved.remaining, ctx);
    } else if (command.length > 0 && NESTED_COMMAND_PARENTS.has(command[0])) {
      // Known parent without valid subcommand — show per-command help
      printCommandHelp(command[0]);
      process.exit(ExitCode.VALIDATION_ERROR);
    } else {
      // Warn if first arg looks like a mistyped command (single lowercase word, no spaces)
      const firstArg = remapped[0];
      if (firstArg && /^[a-z][a-z-]*$/.test(firstArg) && !firstArg.startsWith("-")) {
        p.log.warn(
          `Unknown command: "${firstArg}". Run ${pc.dim("dojops --help")} to see available commands.`,
        );
      }

      // Default: generate command (dojops "prompt")
      const { generateCommand } = await import("./commands/generate");
      await generateCommand(remapped, ctx);
    }
  } catch (err) {
    if (err instanceof CLIError) {
      if (err.message) p.log.error(err.message);
      process.exit(err.exitCode);
    }
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

main().catch((err) => {
  if (err instanceof CLIError) {
    if (err.message) {
      console.error(err.message);
    }
    process.exit(err.exitCode);
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(ExitCode.GENERAL_ERROR);
});
