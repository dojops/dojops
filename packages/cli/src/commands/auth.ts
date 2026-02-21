import pc from "picocolors";
import * as p from "@clack/prompts";
import { loadConfig, saveConfig, getConfigPath, validateProvider } from "../config";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { maskToken } from "../formatter";

export async function authCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "login":
      return authLogin(args.slice(1));
    case "status":
      return authStatus();
    default:
      // If no subcommand, treat as login (oda auth --token ...)
      if (ctx.globalOpts.output === "json") {
        // Support JSON output for auth status
      }
      return authLogin(args);
  }
}

async function authLogin(args: string[]): Promise<void> {
  const token = extractFlagValue(args, "--token");
  if (!token) {
    p.log.warn('Tip: Use "oda config" for interactive setup, or provide --token:');
    p.log.info(`  ${pc.dim("$")} oda auth login --token <API_KEY>`);
    p.log.info(`  ${pc.dim("$")} oda config`);
    process.exit(1);
  }

  const config = loadConfig();
  const providerFlag = extractFlagValue(args, "--provider");
  const provider = providerFlag ?? config.defaultProvider ?? "openai";

  try {
    validateProvider(provider);
  } catch (err) {
    p.log.error((err as Error).message);
    process.exit(1);
  }

  if (provider === "ollama") {
    p.log.error("Ollama runs locally and does not require an API token.");
    p.log.info(
      pc.dim("Just set ODA_PROVIDER=ollama or run: oda auth login --provider openai --token <KEY>"),
    );
    process.exit(1);
  }

  config.tokens = config.tokens ?? {};
  config.tokens[provider] = token;

  if (!config.defaultProvider) {
    config.defaultProvider = provider;
  }

  saveConfig(config);

  p.log.success("Token saved successfully.");

  const noteLines = [
    `${pc.bold("Provider:")} ${provider}`,
    `${pc.bold("Config:")}   ${pc.dim(getConfigPath())}`,
    ...(config.defaultProvider === provider ? [`${pc.bold("Default:")}  ${pc.cyan("yes")}`] : []),
  ];
  p.note(noteLines.join("\n"), "Saved");
  p.log.info(pc.dim('You can now run: oda "your prompt here"'));
}

async function authStatus(): Promise<void> {
  const config = loadConfig();
  const lines = [
    `${pc.bold("Provider:")}  ${config.defaultProvider ?? pc.dim("(not set)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:    ${maskToken(config.tokens?.openai)}`,
    `  anthropic: ${maskToken(config.tokens?.anthropic)}`,
    `  ollama:    ${pc.dim("(local, no token needed)")}`,
  ];
  p.note(lines.join("\n"), "Auth Status");
}
