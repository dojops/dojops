import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  validateProvider,
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

async function providerList(args: string[], ctx: CLIContext): Promise<void> {
  const config = loadConfig();
  const configured = new Set(getConfiguredProviders(config));

  if (ctx.globalOpts.output === "json") {
    const data = VALID_PROVIDERS.map((name) => {
      let token: string | null;
      if (name === "ollama") {
        token = null;
      } else if (config.tokens?.[name]) {
        token = "***";
      } else {
        token = null;
      }
      return {
        name,
        configured: configured.has(name),
        default: config.defaultProvider === name,
        token,
        model: config.defaultProvider === name && config.defaultModel ? config.defaultModel : null,
      };
    });
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
    } else if (name === "github-copilot") {
      detail = isCopilotAuthenticated()
        ? pc.green("authenticated") + " " + pc.dim("(OAuth)")
        : pc.dim("(not set)");
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
  if (name !== "ollama" && name !== "github-copilot" && !config.tokens?.[name]) {
    const addCmd = pc.dim(`dojops provider add ${name}`);
    p.log.warn(`No token configured for ${pc.bold(name)}. Use ${addCmd} to add one.`);
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

  if (name === "github-copilot") {
    // Run OAuth Device Flow instead of prompting for token
    if (isCopilotAuthenticated()) {
      p.log.info(`${pc.bold("github-copilot")} is already authenticated.`);
    } else {
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

    // Fetch available models and let user pick
    if (!ctx.globalOpts.nonInteractive) {
      try {
        const ms = p.spinner();
        ms.start("Fetching available Copilot models...");
        const llm = createProvider({ provider: "github-copilot" });
        const models = await llm.listModels?.();
        ms.stop("Models fetched.");

        if (models && models.length > 0) {
          const customValue = "__custom__";
          const choice = await p.select({
            message: "Select default model for github-copilot:",
            options: [
              ...models.map((m) => ({ value: m, label: m })),
              { value: customValue, label: "Custom model..." },
            ],
            initialValue: config.defaultModel ?? "gpt-4o",
          });

          if (!p.isCancel(choice)) {
            let model = choice as string;
            if (model === customValue) {
              const custom = await p.text({
                message: "Enter custom model name:",
                placeholder: "e.g. gpt-4o, claude-3.5-sonnet, o1-mini",
              });
              if (!p.isCancel(custom) && custom) {
                model = custom as string;
              } else {
                model = "";
              }
            }
            if (model) {
              config.defaultModel = model;
            }
          }
        }
      } catch {
        // Model fetching failed — user can set model later via dojops config
      }
    }

    if (config.defaultProvider) {
      if (config.defaultProvider !== name) {
        saveConfig(config);
        p.log.success(`${pc.bold(name)} is available.`);
        const switchCmd212 = pc.cyan(`dojops provider default ${name}`);
        p.log.info(
          pc.dim(
            `Default provider remains ${pc.bold(config.defaultProvider)}. Use ${switchCmd212} to switch.`,
          ),
        );
      } else {
        saveConfig(config);
        p.log.info(`${pc.bold(name)} is already the default provider.`);
      }
    } else {
      config.defaultProvider = name;
      saveConfig(config);
      p.log.success(`${pc.bold(name)} set as default provider.`);
    }
    return;
  }

  if (name === "ollama") {
    // Ollama doesn't need a token — prompt for host URL in interactive mode
    if (!ctx.globalOpts.nonInteractive) {
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
        return;
      }
      const hostStr = host as string;
      if (hostStr && hostStr !== "http://localhost:11434") {
        config.ollamaHost = hostStr;
      } else {
        delete config.ollamaHost;
      }

      // TLS prompt for HTTPS URLs
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
    }

    const configured = getConfiguredProviders(config);
    // Only ollama counts as "first" if no other provider has a token
    const hasOther = configured.some((p) => p !== "ollama");

    if (config.defaultProvider || hasOther) {
      if (config.defaultProvider !== name) {
        saveConfig(config);
        p.log.success(`${pc.bold(name)} is available.`);
        const switchCmd282 = pc.cyan(`dojops provider default ${name}`);
        p.log.info(
          pc.dim(
            `Default provider remains ${pc.bold(config.defaultProvider ?? "openai")}. Use ${switchCmd282} to switch.`,
          ),
        );
      } else {
        saveConfig(config);
        p.log.info(`${pc.bold(name)} is already the default provider.`);
      }
    } else {
      config.defaultProvider = name;
      saveConfig(config);
      p.log.success(`${pc.bold(name)} set as default provider (first configured provider).`);
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
      const switchCmd334 = pc.cyan(`dojops provider default ${name}`);
      p.log.info(
        pc.dim(
          `Default provider remains ${pc.bold(config.defaultProvider ?? "openai")}. Use ${switchCmd334} to switch.`,
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

  if (name === "github-copilot") {
    const { clearCopilotAuth } = await import("@dojops/core");
    clearCopilotAuth();
    const wasDefault = config.defaultProvider === name;
    if (wasDefault) {
      delete config.defaultProvider;
      saveConfig(config);
    }
    p.log.success(`GitHub Copilot credentials removed.`);
    if (wasDefault) {
      const remaining = getConfiguredProviders(config).filter((p) => p !== "ollama");
      if (remaining.length > 0) {
        const newDefaultCmd417 = pc.cyan(`dojops provider default ${remaining[0]}`);
        p.log.warn(
          `${pc.bold(name)} was the default provider. Use ${newDefaultCmd417} to set a new default.`,
        );
      } else {
        p.log.warn(
          `${pc.bold(name)} was the default provider. No other providers are configured. Use ${pc.cyan("dojops provider add <name>")} to configure one.`,
        );
      }
    }
    return;
  }

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
      const newDefaultCmd448 = pc.cyan(`dojops provider default ${remaining[0]}`);
      p.log.warn(
        `${pc.bold(name)} was the default provider. Use ${newDefaultCmd448} to set a new default.`,
      );
    } else {
      p.log.warn(
        `${pc.bold(name)} was the default provider. No other providers are configured. Use ${pc.cyan("dojops provider add <name>")} to configure one.`,
      );
    }
  }
}
