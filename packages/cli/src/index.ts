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
import { LLMProvider, FallbackProvider } from "@dojops/core";
import {
  resolveProvider,
  resolveModel,
  resolveTemperature,
  resolveToken,
  resolveOllamaHost,
  resolveOllamaTls,
  loadProfileConfig,
} from "./config";
import { parseGlobalOptions, parseCommandPath } from "./parser";
import { remapLegacyArgs } from "./compat";
import { printHelp, printCommandHelp, printBanner } from "./help";
import { resolveCommand, registerCommand, registerSubcommand } from "./commands";
import { CLIContext } from "./types";
import { ExitCode, CLIError, toErrorMessage } from "./exit-codes";
import { getDojopsVersion, findProjectRoot } from "./state";

// ── Late-registered commands (Phases 2-6) ──────────────────────────
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
  skillsListCommand,
  skillsInitCommand,
  skillsValidateCommand,
  skillsPublishCommand,
  skillsInstallCommand,
  skillsSearchCommand,
  skillsDevCommand,
} from "./commands/skills";
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
import { upgradeCommand } from "./commands/upgrade";
import { cronCommand } from "./commands/cron";
import {
  completionBashCommand,
  completionZshCommand,
  completionFishCommand,
  completionInstallCommand,
  completionUsageCommand,
} from "./commands/completion";
import { tokensCommand } from "./commands/tokens";
import { insightsCommand } from "./commands/insights";
import { memoryCommand } from "./commands/memory";
import { runsCommand } from "./commands/runs";
import { mcpCommand } from "./commands/mcp";
import { checkpointCommand } from "./commands/checkpoint";
import { trustCommand, untrustCommand } from "./commands/trust";
import { costCommand } from "./commands/cost";
import { driftCommand } from "./commands/drift";
import { fixDepsCommand } from "./commands/fix-deps";
import { auditExportCommand } from "./commands/audit-export";
import {
  skillsUpdateCommand,
  skillsExportCommand,
  skillsImportCommand,
} from "./commands/skills-extra";
import { recordCommandError } from "./memory";
import { prependToolchainBinToPath, projectToolchainCtx } from "./toolchain-sandbox";
import { withTracking } from "./tracking-provider";

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
registerCommand("upgrade", upgradeCommand);
registerCommand("cron", cronCommand);
registerCommand("tokens", tokensCommand);
registerCommand("insights", insightsCommand);
registerCommand("memory", memoryCommand);
registerCommand("runs", runsCommand);
registerCommand("checkpoint", checkpointCommand);
registerCommand("trust", trustCommand);
registerCommand("untrust", untrustCommand);
registerCommand("cost", costCommand);
registerCommand("drift", driftCommand);
registerCommand("fix-deps", fixDepsCommand);

// Nested: checkpoint <sub>
registerSubcommand("checkpoint", "create", (args, ctx) =>
  checkpointCommand(["create", ...args], ctx),
);
registerSubcommand("checkpoint", "list", (args, ctx) => checkpointCommand(["list", ...args], ctx));
registerSubcommand("checkpoint", "restore", (args, ctx) =>
  checkpointCommand(["restore", ...args], ctx),
);
registerSubcommand("checkpoint", "clean", (args, ctx) =>
  checkpointCommand(["clean", ...args], ctx),
);

// Nested: trust <sub>
registerSubcommand("trust", "list", (args, ctx) => trustCommand(["list", ...args], ctx));

// Nested: runs <sub> (background run management)
registerSubcommand("runs", "list", (args, ctx) => runsCommand(["list", ...args], ctx));
registerSubcommand("runs", "show", (args, ctx) => runsCommand(["show", ...args], ctx));
registerSubcommand("runs", "clean", (args, ctx) => runsCommand(["clean", ...args], ctx));

// Nested: memory <sub> (additional subcommands)
registerSubcommand("memory", "auto", (args, ctx) => memoryCommand(["auto", ...args], ctx));
registerSubcommand("memory", "errors", (args, ctx) => memoryCommand(["errors", ...args], ctx));

// Nested: mcp <sub> (MCP server management)
registerSubcommand("mcp", "list", (args, ctx) => mcpCommand(["list", ...args], ctx));
registerSubcommand("mcp", "add", (args, ctx) => mcpCommand(["add", ...args], ctx));
registerSubcommand("mcp", "remove", (args, ctx) => mcpCommand(["remove", ...args], ctx));

// `dojops version` → print version and exit
registerCommand("version", async () => {
  console.log(`dojops v${getDojopsVersion()}`);
});

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
registerSubcommand("history", "repair", (args, ctx) => historyCommand(["repair", ...args], ctx));
registerSubcommand("history", "export", (args, ctx) => auditExportCommand(args, ctx));
registerCommand("provider", providerCommand);

// Nested: skills <sub> (.dops skills)
registerSubcommand("skills", "list", skillsListCommand);
registerSubcommand("skills", "init", skillsInitCommand);
registerSubcommand("skills", "validate", skillsValidateCommand);
registerSubcommand("skills", "publish", skillsPublishCommand);
registerSubcommand("skills", "install", skillsInstallCommand);
registerSubcommand("skills", "search", skillsSearchCommand);
registerSubcommand("skills", "dev", skillsDevCommand);
registerSubcommand("skills", "update", skillsUpdateCommand);
registerSubcommand("skills", "export", skillsExportCommand);
registerSubcommand("skills", "import", skillsImportCommand);

// Nested: toolchain <sub> (system binaries)
registerSubcommand("toolchain", "list", toolchainListCommand);
registerSubcommand("toolchain", "load", toolchainLoadCommand);
registerSubcommand("toolchain", "install", toolchainInstallCommand);
registerSubcommand("toolchain", "remove", toolchainRemoveCommand);
registerSubcommand("toolchain", "clean", toolchainCleanCommand);

// Nested: completion <sub> (shell completion scripts)
registerCommand("completion", completionUsageCommand);
registerSubcommand("completion", "bash", completionBashCommand);
registerSubcommand("completion", "zsh", completionZshCommand);
registerSubcommand("completion", "fish", completionFishCommand);
registerSubcommand("completion", "install", completionInstallCommand);

// ── Main ───────────────────────────────────────────────────────────

/** Detect if we're running in a CI environment. */
function detectCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL ||
    process.env.CIRCLECI ||
    process.env.TF_BUILD
  );
}

/** Handle early-exit flags (--version, empty args). Returns true if exited. */
function handleEarlyExits(rawArgs: string[]): boolean {
  if (rawArgs.length === 0) {
    printHelp();
    process.exit(0);
  }
  if (rawArgs.includes("--version") || rawArgs.includes("-V") || rawArgs.includes("-v")) {
    console.log(`dojops v${getDojopsVersion()}`);
    process.exit(0);
  }
  // --get-completions <type> — hidden flag for shell completion scripts
  const gcIdx = rawArgs.indexOf("--get-completions");
  if (gcIdx !== -1 && gcIdx + 1 < rawArgs.length) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { handleGetCompletions } = require("./completions/get-completions");
    handleGetCompletions(rawArgs[gcIdx + 1]);
  }
  return false;
}

/** Apply CI / non-TTY / --no-color environment overrides. */
function applyEnvironmentOverrides(
  globalOpts: ReturnType<typeof parseGlobalOptions>["globalOpts"],
  isCI: boolean,
): void {
  if (isCI || !process.stdout.isTTY) {
    globalOpts.nonInteractive = true;
    if (!process.stdout.isTTY) process.env.NO_COLOR = "1";
  }
  if (globalOpts.nonInteractive && !process.env.NO_COLOR) process.env.NO_COLOR = "1";
  if (globalOpts.noColor) process.env.NO_COLOR = "1";
}

/** Build the lazy-initializing LLM provider for CLIContext. */
function buildLazyProvider(
  globalOpts: ReturnType<typeof parseGlobalOptions>["globalOpts"],
  config: ReturnType<typeof loadProfileConfig>,
): () => LLMProvider {
  let cachedProvider: LLMProvider | undefined;
  return () => {
    if (cachedProvider) return cachedProvider;

    let providerName: string;
    try {
      providerName = resolveProvider(globalOpts.provider, config);
    } catch (err) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
    }

    const model = resolveModel(globalOpts.model, config);
    const apiKey = resolveToken(providerName, config);
    const ollamaHost = providerName === "ollama" ? resolveOllamaHost(undefined, config) : undefined;
    const ollamaTls = providerName === "ollama" ? resolveOllamaTls(undefined, config) : undefined;
    let provider: LLMProvider = createProvider({
      provider: providerName,
      model,
      apiKey,
      ollamaHost,
      ollamaTlsRejectUnauthorized: ollamaTls === false ? false : undefined,
    });

    // Display active provider and model
    const modelLabel = model ? ` (${model})` : "";
    p.log.info(`Using ${pc.bold(providerName)}${pc.dim(modelLabel)}`);

    const fallbackSpec = globalOpts.fallbackProvider ?? process.env.DOJOPS_FALLBACK_PROVIDER;
    if (fallbackSpec) {
      const fallbackNames = fallbackSpec
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const chain: LLMProvider[] = [provider];
      for (const name of fallbackNames) {
        try {
          const fbKey = resolveToken(name, config);
          // Fallback providers use their own default model — not the primary's DOJOPS_MODEL.
          // Pass empty string to prevent createProvider from reading DOJOPS_MODEL env.
          chain.push(createProvider({ provider: name, model: "", apiKey: fbKey }));
        } catch {
          // Skip misconfigured fallback provider
        }
      }
      if (chain.length > 1) {
        provider = new FallbackProvider(chain);
      }
    }

    // Wrap with token usage tracking
    const root = findProjectRoot();
    cachedProvider = withTracking(provider, root, "cli");
    return cachedProvider;
  };
}

const QUIET_COMMANDS = new Set([
  "config",
  "auth",
  "provider",
  "init",
  "doctor",
  "status",
  "skills",
  "toolchain",
  "scan",
  "version",
  "chat",
  "check",
  "verify",
  "upgrade",
  "skills",
  "agents",
  "history",
  "serve",
  "help",
  "cron",
  "completion",
  "tokens",
  "insights",
  "memory",
  "runs",
  "mcp",
  "checkpoint",
  "trust",
  "untrust",
  "cost",
  "drift",
  "fix-deps",
]);

const NESTED_COMMAND_PARENTS = new Set([
  "debug",
  "analyze",
  "agents",
  "history",
  "skills",
  "toolchain",
  "inspect",
  "scan",
  "completion",
  "runs",
  "mcp",
  "checkpoint",
  "trust",
]);

/** Route the resolved command or fall back to generate. */
async function dispatchCommand(
  resolved: ReturnType<typeof resolveCommand>,
  command: string[],
  remapped: string[],
  ctx: CLIContext,
): Promise<void> {
  if (resolved) {
    await resolved.handler(resolved.remaining, ctx);
    return;
  }
  if (command.length > 0 && NESTED_COMMAND_PARENTS.has(command[0])) {
    printCommandHelp(command[0]);
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const firstArg = remapped[0];
  if (firstArg && /^[a-z][a-z-]*$/.test(firstArg) && !firstArg.startsWith("-")) {
    p.log.warn(
      `Unknown command: "${firstArg}". Run ${pc.dim("dojops --help")} to see available commands.`,
    );
    p.log.info(pc.dim(`If you meant to generate, use: dojops generate "${remapped.join(" ")}"`));
    process.exit(ExitCode.VALIDATION_ERROR);
  }

  const { generateCommand } = await import("./commands/generate");
  await generateCommand(remapped, ctx);
}

/** Handle --help / -h flag, printing appropriate help and exiting. */
function handleHelpFlag(rawArgs: string[], command: string[]): void {
  if (!rawArgs.includes("--help") && !rawArgs.includes("-h")) return;
  if (command.length > 0) {
    printCommandHelp(command.join(" "));
  } else {
    printHelp();
  }
  process.exit(0);
}

/** Build the CLIContext from parsed options. */
function buildCLIContext(
  globalOpts: ReturnType<typeof parseGlobalOptions>["globalOpts"],
  config: ReturnType<typeof loadProfileConfig>,
): CLIContext {
  return {
    globalOpts,
    config,
    cwd: process.cwd(),
    resolvedTemperature: resolveTemperature(globalOpts.temperature, config),
    getProvider: buildLazyProvider(globalOpts, config),
  };
}

/** Determine whether to show the DojOps banner. */
function shouldShowBanner(
  command: string[],
  isCI: boolean,
  globalOpts: ReturnType<typeof parseGlobalOptions>["globalOpts"],
): boolean {
  const isQuiet = command.length > 0 && QUIET_COMMANDS.has(command[0]);
  return !isQuiet && !isCI && !globalOpts.quiet && !globalOpts.raw && globalOpts.output === "table";
}

/** Handle caught errors from command dispatch. */
function handleCommandError(err: unknown, debug: boolean): never {
  if (err instanceof CLIError) {
    if (err.message) p.log.error(err.message);
    process.exit(err.exitCode);
  }
  p.log.error(toErrorMessage(err));
  if (debug) console.error(err);
  process.exit(ExitCode.GENERAL_ERROR);
}

async function main() {
  process.on("SIGINT", () => {
    process.stdout.write("\x1b[?25h");
    process.exit(130);
  });

  process.on("SIGTERM", () => {
    process.stdout.write("\x1B[?25h"); // restore cursor
    process.exit(0);
  });

  // Prepend both project and global toolchain bin dirs to PATH
  const projectRoot = findProjectRoot();
  prependToolchainBinToPath(projectRoot ? projectToolchainCtx(projectRoot) : undefined);

  const isCI = detectCI();
  const rawArgs = process.argv.slice(2);
  handleEarlyExits(rawArgs);

  const { globalOpts, remaining } = parseGlobalOptions(rawArgs);
  applyEnvironmentOverrides(globalOpts, isCI);

  const remapped = remapLegacyArgs(remaining);
  const { command, positional } = parseCommandPath(remapped);

  handleHelpFlag(rawArgs, command);

  const resolved = resolveCommand(command, positional);
  const config = loadProfileConfig(globalOpts.profile);
  const ctx = buildCLIContext(globalOpts, config);

  const showBanner = shouldShowBanner(command, isCI, globalOpts);
  if (showBanner) printBanner();

  try {
    await dispatchCommand(resolved, command, remapped, ctx);
  } catch (err) {
    // Record error pattern for learning (best-effort)
    const cmdName = command[0] ?? "unknown";
    const root = findProjectRoot();
    if (root) {
      recordCommandError(root, cmdName, toErrorMessage(err));
    }
    handleCommandError(err, globalOpts.debug);
  }

  if (showBanner) p.outro("Done.");
}

// Top-level async entry — CJS module, top-level await not supported
main() // NOSONAR — S7785: CJS module cannot use top-level await
  .then(() => process.exit(ExitCode.SUCCESS))
  .catch((err) => {
    if (err instanceof CLIError) {
      if (err.message) console.error(err.message);
      process.exit(err.exitCode);
    }
    console.error(toErrorMessage(err));
    process.exit(ExitCode.GENERAL_ERROR);
  });
