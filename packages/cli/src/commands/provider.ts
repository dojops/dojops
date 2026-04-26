import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  validateProvider,
  resolveProvider,
  VALID_PROVIDERS,
  getConfiguredProviders,
} from "../config";
import { copilotLogin, isCopilotAuthenticated } from "@dojops/core";
import { createProvider } from "@dojops/api";
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

/** Validate a provider name argument, throwing CLIError if missing or unknown. */
function requireProviderArg(args: string[], usage: string): string {
  const name = args[0];
  if (!name) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `${usage}\nSupported: ${VALID_PROVIDERS.join(", ")}`,
    );
  }
  try {
    validateProvider(name);
  } catch (err) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
  }
  return name;
}

/** Get the display detail for a provider in the list. */
function getProviderDetail(name: string, config: ReturnType<typeof loadConfig>): string {
  if (name === "ollama") return pc.dim("(local)");
  if (name === "github-copilot") {
    return isCopilotAuthenticated()
      ? pc.green("authenticated") + " " + pc.dim("(OAuth)")
      : pc.dim("(not set)");
  }
  return config.tokens?.[name] ? maskToken(config.tokens[name]) : pc.dim("(not set)");
}

async function providerList(args: string[], ctx: CLIContext): Promise<void> {
  const config = loadConfig();
  const configured = new Set(getConfiguredProviders(config));
  const activeProvider = resolveProvider(ctx.globalOpts.provider, config);

  if (ctx.globalOpts.output === "json") {
    const data = VALID_PROVIDERS.map((name) => ({
      name,
      configured: configured.has(name),
      active: activeProvider === name,
      default: config.defaultProvider === name,
      token: name !== "ollama" && config.tokens?.[name] ? "***" : null,
      model: activeProvider === name && config.defaultModel ? config.defaultModel : null,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const lines: string[] = [];
  for (const name of VALID_PROVIDERS) {
    const isActive = activeProvider === name;
    const icon = isActive ? pc.green("*") : configured.has(name) ? pc.cyan("o") : pc.dim("o");
    const activeBadge = isActive ? pc.cyan(" (active)") : "";
    const detail = getProviderDetail(name, config);
    const model =
      isActive && config.defaultModel ? `  ${pc.dim("model:")} ${config.defaultModel}` : "";
    lines.push(`  ${icon} ${pc.bold(name)}${activeBadge}  ${detail}${model}`);
  }

  p.note(lines.join("\n"), "Providers");
}

async function providerDefault(args: string[]): Promise<void> {
  const name = requireProviderArg(args, "Usage: dojops provider default <name>");
  const config = loadConfig();

  // Warn if no token configured (but allow it)
  if (name !== "ollama" && name !== "github-copilot" && !config.tokens?.[name]) {
    const addCmd = pc.dim(`dojops provider add ${name}`);
    p.log.warn(`No token configured for ${pc.bold(name)}. Use ${addCmd} to add one.`);
  }

  config.defaultProvider = name;
  saveConfig(config);
  p.log.success(`Default provider set to ${pc.bold(name)}.`);
}

/** Show a hint that the default provider is unchanged and how to switch. */
function logDefaultRemains(config: ReturnType<typeof loadConfig>, name: string): void {
  const switchCmd = pc.cyan(`dojops provider default ${name}`);
  p.log.info(
    pc.dim(
      `Default provider remains ${pc.bold(config.defaultProvider ?? "openai")}. Use ${switchCmd} to switch.`,
    ),
  );
}

/** Log default-provider status after adding a provider. */
function logProviderSetupResult(
  config: ReturnType<typeof loadConfig>,
  name: string,
  isFirstProvider: boolean,
): void {
  if (isFirstProvider && !config.defaultProvider) {
    config.defaultProvider = name;
    saveConfig(config);
    p.log.success(`${pc.bold(name)} set as default provider.`);
    return;
  }
  if (config.defaultProvider === name) {
    saveConfig(config);
    p.log.info(`${pc.bold(name)} is already the default provider.`);
    return;
  }
  saveConfig(config);
  p.log.success(`${pc.bold(name)} is available.`);
  logDefaultRemains(config, name);
}

/** Run the GitHub Copilot OAuth Device Flow. */
async function runCopilotAuth(): Promise<void> {
  if (isCopilotAuthenticated()) {
    p.log.info(`${pc.bold("github-copilot")} is already authenticated.`);
    return;
  }
  const s = p.spinner();
  s.start("Starting GitHub Copilot OAuth Device Flow...");
  await copilotLogin({
    onDeviceCode: (userCode, verificationUri) => {
      s.stop("Device code received.");
      p.note(
        [
          `Code: ${pc.bold(pc.cyan(userCode))}`,
          `URL:  ${pc.underline(verificationUri)}`,
          "",
          "Open the URL above and paste the code to authorize DojOps.",
        ].join("\n"),
        "GitHub Device Authorization",
      );
      s.start("Waiting for authorization...");
    },
    onStatus: (msg) => s.message(msg),
  });
  s.stop("Authenticated with GitHub Copilot.");
}

/** Prompt user to select a Copilot model interactively. */
async function promptCopilotModel(config: ReturnType<typeof loadConfig>): Promise<void> {
  try {
    const ms = p.spinner();
    ms.start("Fetching available Copilot models...");
    const llm = createProvider({ provider: "github-copilot" });
    const models = await llm.listModels?.();
    ms.stop("Models fetched.");

    if (!models || models.length === 0) return;

    const customValue = "__custom__";
    const choice = await p.select({
      message: "Select default model for github-copilot:",
      options: [
        ...models.map((m) => ({ value: m, label: m })),
        { value: customValue, label: "Custom model..." },
      ],
      initialValue: config.defaultModel ?? "gpt-4o",
    });

    if (p.isCancel(choice)) return;

    let model = choice as string;
    if (model === customValue) {
      const custom = await p.text({
        message: "Enter custom model name:",
        placeholder: "e.g. gpt-4o, claude-3.5-sonnet, o1-mini",
      });
      model = !p.isCancel(custom) && custom ? (custom as string) : "";
    }
    if (model) {
      config.defaultModel = model;
    }
  } catch {
    // Model fetching failed — user can set model later via dojops config
  }
}

/** Handle `provider add github-copilot`. */
async function addCopilotProvider(
  config: ReturnType<typeof loadConfig>,
  name: string,
  ctx: CLIContext,
): Promise<void> {
  await runCopilotAuth();
  if (!ctx.globalOpts.nonInteractive) {
    await promptCopilotModel(config);
  }
  logProviderSetupResult(config, name, !config.defaultProvider);
}

/** Prompt for Ollama host URL and TLS settings interactively. */
async function promptOllamaHost(config: ReturnType<typeof loadConfig>): Promise<boolean> {
  const host = await p.text({
    message: "Ollama server URL:",
    placeholder: "http://localhost:11434",
    defaultValue: config.ollamaHost ?? "http://localhost:11434",
    validate: (val) => {
      if (!val) return undefined;
      try {
        const u = new URL(val);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return "URL must use http:// or https://";
        }
      } catch {
        return "Invalid URL";
      }
      return undefined;
    },
  });
  if (p.isCancel(host)) {
    p.log.info("Cancelled.");
    return false;
  }
  const hostStr = host as string;
  if (hostStr && hostStr !== "http://localhost:11434") {
    config.ollamaHost = hostStr;
  } else {
    delete config.ollamaHost;
  }

  if (hostStr.startsWith("https://")) {
    const tls = await p.confirm({
      message: "Verify TLS certificates? (disable for self-signed certs)",
      initialValue: config.ollamaTlsRejectUnauthorized ?? true,
    });
    if (!p.isCancel(tls)) {
      if (tls === false) {
        config.ollamaTlsRejectUnauthorized = false;
      } else {
        delete config.ollamaTlsRejectUnauthorized;
      }
    }
  }
  return true;
}

/** Handle `provider add ollama`. */
async function addOllamaProvider(
  config: ReturnType<typeof loadConfig>,
  name: string,
  ctx: CLIContext,
): Promise<void> {
  if (!ctx.globalOpts.nonInteractive) {
    const ok = await promptOllamaHost(config);
    if (!ok) return;
  }

  const configured = getConfiguredProviders(config);
  const hasOther = configured.some((prov) => prov !== "ollama");
  logProviderSetupResult(config, name, !hasOther);
}

/** Handle `provider add <name>` for token-based providers. */
async function addTokenProvider(
  config: ReturnType<typeof loadConfig>,
  name: string,
  args: string[],
  ctx: CLIContext,
): Promise<void> {
  let token = extractFlagValue(args.slice(1), "--token");

  if (!token) {
    if (ctx.globalOpts.nonInteractive) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Token required. Use: dojops provider add ${name} --token <KEY>`,
      );
    }

    const input = await p.password({ message: `API key for ${name}:` });
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

  const configuredBefore = Object.entries(config.tokens)
    .filter(([k, v]) => k !== name && v)
    .map(([k]) => k);
  const isFirst = configuredBefore.length === 0;

  if (isFirst && !config.defaultProvider) {
    config.defaultProvider = name;
  }

  saveConfig(config);
  p.log.success(`Token saved for ${pc.bold(name)}.`);

  if (isFirst && config.defaultProvider === name) {
    p.log.info(pc.dim(`${pc.bold(name)} set as default provider (first configured provider).`));
  } else if (config.defaultProvider !== name) {
    logDefaultRemains(config, name);
  }
}

async function providerAdd(args: string[], ctx: CLIContext): Promise<void> {
  const name = requireProviderArg(args, "Usage: dojops provider add <name> [--token KEY]");
  const config = loadConfig();

  if (name === "github-copilot") return addCopilotProvider(config, name, ctx);
  if (name === "ollama") return addOllamaProvider(config, name, ctx);
  return addTokenProvider(config, name, args, ctx);
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

/** Warn user that the removed provider was the default and suggest alternatives. */
function warnRemovedDefault(config: ReturnType<typeof loadConfig>, name: string): void {
  const remaining = getConfiguredProviders(config).filter((prov) => prov !== "ollama");
  if (remaining.length > 0) {
    const newDefaultCmd = pc.cyan(`dojops provider default ${remaining[0]}`);
    p.log.warn(
      `${pc.bold(name)} was the default provider. Use ${newDefaultCmd} to set a new default.`,
    );
  } else {
    p.log.warn(
      `${pc.bold(name)} was the default provider. No other providers are configured. Use ${pc.cyan("dojops provider add <name>")} to configure one.`,
    );
  }
}

async function providerRemove(args: string[]): Promise<void> {
  const name = requireProviderArg(args, "Usage: dojops provider remove <name>");

  if (name === "ollama") {
    p.log.info("Ollama is a local provider and cannot be removed.");
    return;
  }

  const config = loadConfig();

  if (name === "github-copilot") {
    const { clearCopilotAuth } = await import("@dojops/core");
    clearCopilotAuth();
    const wasDefault = config.defaultProvider === name;
    if (wasDefault) {
      delete config.defaultProvider;
      saveConfig(config);
    }
    p.log.success(`GitHub Copilot credentials removed.`);
    if (wasDefault) warnRemovedDefault(config, name);
    return;
  }

  if (!config.tokens?.[name]) {
    p.log.info(`No token stored for ${pc.bold(name)}.`);
    return;
  }

  delete config.tokens[name];
  const wasDefault = config.defaultProvider === name;
  if (wasDefault) delete config.defaultProvider;
  saveConfig(config);
  p.log.success(`Token removed for ${pc.bold(name)}.`);
  if (wasDefault) warnRemovedDefault(config, name);
}
