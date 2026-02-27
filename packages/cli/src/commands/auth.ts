import pc from "picocolors";
import * as p from "@clack/prompts";
import { loadConfig, saveConfig, getConfigPath, validateProvider } from "../config";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { maskToken } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";

export async function authCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "login":
      return authLogin(args.slice(1), ctx);
    case "status":
      return authStatus();
    case "logout":
      return authLogout(args.slice(1), ctx);
    default:
      // If no subcommand, treat as login (dojops auth --token ...)
      return authLogin(args, ctx);
  }
}

async function authLogin(args: string[], ctx: CLIContext): Promise<void> {
  const token = extractFlagValue(args, "--token");
  if (!token) {
    p.log.warn('Tip: Use "dojops config" for interactive setup, or provide --token:');
    p.log.info(`  ${pc.dim("$")} dojops auth login --token <API_KEY>`);
    p.log.info(`  ${pc.dim("$")} dojops config`);
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }

  const config = loadConfig();
  const providerFlag = extractFlagValue(args, "--provider");
  const provider = providerFlag ?? ctx.globalOpts.provider ?? config.defaultProvider ?? "openai";

  try {
    validateProvider(provider);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }

  if (provider === "ollama") {
    p.log.info(
      pc.dim(
        "Just set DOJOPS_PROVIDER=ollama or run: dojops auth login --provider openai --token <KEY>",
      ),
    );
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "Ollama runs locally and does not require an API token.",
    );
  }

  config.tokens = config.tokens ?? {};
  config.tokens[provider] = token;

  if (!config.defaultProvider) {
    config.defaultProvider = provider;
  }

  saveConfig(config);

  p.log.success("Token saved successfully.");

  const isDefault = config.defaultProvider === provider;
  const defaultNote = isDefault
    ? `${pc.bold("Default:")}  ${pc.cyan("yes")}${!providerFlag ? " (first configured provider)" : ""}`
    : `${pc.bold("Default:")}  no (default is ${pc.bold(config.defaultProvider!)})`;

  const noteLines = [
    `${pc.bold("Provider:")} ${provider}`,
    `${pc.bold("Config:")}   ${pc.dim(getConfigPath())}`,
    defaultNote,
  ];
  p.note(noteLines.join("\n"), "Saved");

  if (!isDefault) {
    p.log.info(
      pc.dim(`Use ${pc.cyan(`dojops provider default ${provider}`)} to make it the default.`),
    );
  }

  p.log.warn(
    `Token stored in plaintext at ${getConfigPath()}. Ensure this file has restricted permissions.`,
  );
  p.log.info(pc.dim('You can now run: dojops "your prompt here"'));
}

async function authLogout(args: string[], ctx: CLIContext): Promise<void> {
  const config = loadConfig();
  const providerFlag = extractFlagValue(args, "--provider");
  const all = args.includes("--all");

  if (all) {
    config.tokens = {};
    saveConfig(config);
    p.log.success("All tokens removed.");
    return;
  }

  const provider =
    providerFlag ?? ctx.globalOpts.provider ?? ctx.config.defaultProvider ?? "openai";

  if (!config.tokens?.[provider]) {
    p.log.info(`No token stored for ${pc.bold(provider)}.`);
    return;
  }

  delete config.tokens[provider];
  saveConfig(config);
  p.log.success(`Token removed for ${pc.bold(provider)}.`);
}

async function authStatus(): Promise<void> {
  const config = loadConfig();
  const lines = [
    `${pc.bold("Provider:")}  ${config.defaultProvider ?? pc.dim("(not set)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:    ${maskToken(config.tokens?.openai)}`,
    `  anthropic: ${maskToken(config.tokens?.anthropic)}`,
    `  deepseek:  ${maskToken(config.tokens?.deepseek)}`,
    `  gemini:    ${maskToken(config.tokens?.gemini)}`,
    `  ollama:    ${pc.dim("(local, no token needed)")}`,
  ];
  p.note(lines.join("\n"), "Auth Status");
}
