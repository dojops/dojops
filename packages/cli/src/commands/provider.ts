import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  validateProvider,
  VALID_PROVIDERS,
  getConfiguredProviders,
} from "../config";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { maskToken } from "../formatter";
import { ExitCode, CLIError } from "../exit-codes";

export async function providerCommand(args: string[], ctx: CLIContext): Promise<void> {
  // Handle --as-default <name> before subcommand dispatch
  const asDefault = extractFlagValue(args, "--as-default");
  if (asDefault) {
    return providerDefault([asDefault]);
  }

  const sub = args[0];
  switch (sub) {
    case "list":
      return providerList(args.slice(1), ctx);
    case "default":
      return providerDefault(args.slice(1));
    case "add":
      return providerAdd(args.slice(1), ctx);
    case "remove":
      return providerRemove(args.slice(1));
    case "switch":
      return providerSwitch(ctx);
    default:
      // No subcommand → list
      return providerList(args, ctx);
  }
}

async function providerList(args: string[], ctx: CLIContext): Promise<void> {
  const config = loadConfig();
  const configured = new Set(getConfiguredProviders(config));

  if (ctx.globalOpts.output === "json") {
    const data = VALID_PROVIDERS.map((name) => ({
      name,
      configured: configured.has(name),
      default: config.defaultProvider === name,
      token: name === "ollama" ? null : config.tokens?.[name] ? "***" : null,
      model: config.defaultProvider === name && config.defaultModel ? config.defaultModel : null,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines: string[] = [];
  for (const name of VALID_PROVIDERS) {
    const isConfigured = configured.has(name);
    const isDefault = config.defaultProvider === name;
    const icon = isConfigured ? pc.green("*") : pc.dim("o");
    const defaultBadge = isDefault ? pc.cyan(" (default)") : "";
    let detail: string;

    if (name === "ollama") {
      detail = pc.dim("(local)");
    } else if (config.tokens?.[name]) {
      detail = maskToken(config.tokens[name]);
    } else {
      detail = pc.dim("(not set)");
    }

    const model =
      isDefault && config.defaultModel ? `  ${pc.dim("model:")} ${config.defaultModel}` : "";

    lines.push(`  ${icon} ${pc.bold(name)}${defaultBadge}  ${detail}${model}`);
  }

  p.note(lines.join("\n"), "Providers");
}

async function providerDefault(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Usage: dojops provider default <name>\nSupported: ${VALID_PROVIDERS.join(", ")}`,
    );
  }

  try {
    validateProvider(name);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }

  const config = loadConfig();

  // Warn if no token configured (but allow it)
  if (name !== "ollama" && !config.tokens?.[name]) {
    p.log.warn(
      `No token configured for ${pc.bold(name)}. Use ${pc.dim(`dojops provider add ${name}`)} to add one.`,
    );
  }

  config.defaultProvider = name;
  saveConfig(config);
  p.log.success(`Default provider set to ${pc.bold(name)}.`);
}

async function providerAdd(args: string[], ctx: CLIContext): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Usage: dojops provider add <name> [--token KEY]\nSupported: ${VALID_PROVIDERS.join(", ")}`,
    );
  }

  try {
    validateProvider(name);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }

  const config = loadConfig();
  let token = extractFlagValue(args.slice(1), "--token");

  if (name === "ollama") {
    // Ollama doesn't need a token
    const configured = getConfiguredProviders(config);
    // Only ollama counts as "first" if no other provider has a token
    const hasOther = configured.some((p) => p !== "ollama");

    if (!config.defaultProvider && !hasOther) {
      config.defaultProvider = name;
      saveConfig(config);
      p.log.success(`${pc.bold(name)} set as default provider (first configured provider).`);
    } else if (config.defaultProvider !== name) {
      saveConfig(config);
      p.log.success(`${pc.bold(name)} is available.`);
      p.log.info(
        pc.dim(
          `Default provider remains ${pc.bold(config.defaultProvider ?? "openai")}. Use ${pc.cyan(`dojops provider default ${name}`)} to switch.`,
        ),
      );
    } else {
      p.log.info(`${pc.bold(name)} is already the default provider.`);
    }
    return;
  }

  // Non-ollama: need a token
  if (!token) {
    if (ctx.globalOpts.nonInteractive) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Token required. Use: dojops provider add ${name} --token <KEY>`,
      );
    }

    const input = await p.password({
      message: `API key for ${name}:`,
    });
    if (p.isCancel(input)) {
      p.log.info("Cancelled.");
      return;
    }
    token = input as string;
    if (!token) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, "Token cannot be empty.");
    }
  }

  config.tokens = config.tokens ?? {};
  config.tokens[name] = token;

  // Check if this is the first configured provider (excluding ollama)
  const configuredBefore = Object.entries(config.tokens)
    .filter(([k, v]) => k !== name && v)
    .map(([k]) => k);
  const isFirst = configuredBefore.length === 0;

  if (isFirst && !config.defaultProvider) {
    config.defaultProvider = name;
    saveConfig(config);
    p.log.success(`Token saved for ${pc.bold(name)}.`);
    p.log.info(pc.dim(`${pc.bold(name)} set as default provider (first configured provider).`));
  } else {
    saveConfig(config);
    p.log.success(`Token saved for ${pc.bold(name)}.`);
    if (config.defaultProvider !== name) {
      p.log.info(
        pc.dim(
          `Default provider remains ${pc.bold(config.defaultProvider ?? "openai")}. Use ${pc.cyan(`dojops provider default ${name}`)} to switch.`,
        ),
      );
    }
  }
}

async function providerSwitch(ctx: CLIContext): Promise<void> {
  if (ctx.globalOpts.nonInteractive) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "provider switch requires interactive mode. Use: dojops provider default <name>",
    );
  }

  const config = loadConfig();
  const configured = getConfiguredProviders(config);

  if (configured.length === 0) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `No providers configured. Use ${pc.cyan("dojops provider add <name>")} to add one.`,
    );
  }

  const options = configured.map((name) => {
    const isDefault = config.defaultProvider === name;
    const label = isDefault ? `${name} (current default)` : name;
    return { value: name, label };
  });

  const choice = await p.select({
    message: "Switch default provider to:",
    options,
    initialValue: config.defaultProvider ?? configured[0],
  });

  if (p.isCancel(choice)) {
    p.log.info("Cancelled.");
    return;
  }

  const name = choice as string;
  config.defaultProvider = name;
  saveConfig(config);
  p.log.success(`Default provider switched to ${pc.bold(name)}.`);
}

async function providerRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Usage: dojops provider remove <name>\nSupported: ${VALID_PROVIDERS.join(", ")}`,
    );
  }

  try {
    validateProvider(name);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }

  if (name === "ollama") {
    p.log.info("Ollama is a local provider and cannot be removed.");
    return;
  }

  const config = loadConfig();

  if (!config.tokens?.[name]) {
    p.log.info(`No token stored for ${pc.bold(name)}.`);
    return;
  }

  delete config.tokens[name];

  const wasDefault = config.defaultProvider === name;
  if (wasDefault) {
    delete config.defaultProvider;
  }

  saveConfig(config);
  p.log.success(`Token removed for ${pc.bold(name)}.`);

  if (wasDefault) {
    // Suggest an alternative
    const remaining = getConfiguredProviders(config).filter((p) => p !== "ollama");
    if (remaining.length > 0) {
      p.log.warn(
        `${pc.bold(name)} was the default provider. Use ${pc.cyan(`dojops provider default ${remaining[0]}`)} to set a new default.`,
      );
    } else {
      p.log.warn(
        `${pc.bold(name)} was the default provider. No other providers are configured. Use ${pc.cyan("dojops provider add <name>")} to configure one.`,
      );
    }
  }
}
