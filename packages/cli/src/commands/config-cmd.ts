import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  validateProvider,
  VALID_PROVIDERS,
  DojOpsConfig,
} from "../config";
import { CLIContext } from "../types";
import { maskToken } from "../formatter";
import { extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { createProvider } from "@dojops/api";

function showConfig(config: DojOpsConfig): void {
  const lines = [
    `${pc.bold("Provider:")}  ${config.defaultProvider ?? pc.dim("(not set)")}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Temperature:")} ${config.defaultTemperature != null ? String(config.defaultTemperature) : pc.dim("(not set)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:    ${maskToken(config.tokens?.openai)}`,
    `  anthropic: ${maskToken(config.tokens?.anthropic)}`,
    `  deepseek:  ${maskToken(config.tokens?.deepseek)}`,
    `  gemini:    ${maskToken(config.tokens?.gemini)}`,
    `  ollama:    ${pc.dim("(no token needed)")}`,
  ];
  p.note(lines.join("\n"), `Configuration ${pc.dim(`(${getConfigPath()})`)}`);
}

export async function configCommand(args: string[], ctx: CLIContext): Promise<void> {
  // dojops config show (--show is remapped by compat.ts)
  if (args[0] === "show") {
    const config = loadConfig();
    if (ctx.globalOpts.output === "json") {
      const safeConfig = {
        ...config,
        tokens: Object.fromEntries(
          Object.entries(config.tokens ?? {}).map(([k, v]) => [k, v ? "***" : null]),
        ),
      };
      console.log(JSON.stringify(safeConfig, null, 2));
    } else {
      showConfig(config);
    }
    return;
  }

  // dojops config reset — delete configuration file
  if (args[0] === "reset") {
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) {
      p.log.info("No configuration file to reset.");
      return;
    }

    if (!ctx.globalOpts.nonInteractive) {
      const confirmed = await p.confirm({
        message: `Delete configuration at ${configPath}?`,
      });
      if (p.isCancel(confirmed) || !confirmed) {
        p.log.info("Cancelled.");
        return;
      }
    }

    fs.unlinkSync(configPath);
    p.log.success("Configuration reset successfully.");
    return;
  }

  // dojops config profile <subcommand> — handled in Phase 6
  if (args[0] === "profile") {
    const { configProfileCommand } = await import("./config-profile");
    return configProfileCommand(args.slice(1), ctx);
  }

  const providerFlag = extractFlagValue(args, "--provider") ?? ctx.globalOpts.provider;
  const tokenFlag = extractFlagValue(args, "--token");
  const modelFlag = extractFlagValue(args, "--model") ?? ctx.globalOpts.model;
  const temperatureFlag = extractFlagValue(args, "--temperature");

  // Direct flags mode
  if (providerFlag || tokenFlag || modelFlag || temperatureFlag) {
    const config = loadConfig();

    if (providerFlag) {
      try {
        validateProvider(providerFlag);
      } catch (err) {
        throw new CLIError(ExitCode.VALIDATION_ERROR, (err as Error).message);
      }
      config.defaultProvider = providerFlag;
    }

    if (tokenFlag) {
      const provider = providerFlag ?? config.defaultProvider ?? "openai";
      if (provider === "ollama") {
        throw new CLIError(
          ExitCode.VALIDATION_ERROR,
          "Ollama runs locally and does not require an API token.",
        );
      }
      config.tokens = config.tokens ?? {};
      config.tokens[provider] = tokenFlag;
    }

    if (modelFlag) {
      config.defaultModel = modelFlag;
    }

    if (temperatureFlag) {
      const temp = parseFloat(temperatureFlag);
      if (!Number.isFinite(temp) || temp < 0 || temp > 2) {
        throw new CLIError(
          ExitCode.VALIDATION_ERROR,
          "Temperature must be a number between 0 and 2.",
        );
      }
      config.defaultTemperature = temp;
    }

    saveConfig(config);
    p.log.success("Configuration saved.");
    showConfig(config);
    return;
  }

  // Interactive mode
  const config = loadConfig();

  p.intro(pc.bgCyan(pc.black(" dojops config ")));

  if (config.defaultProvider || config.defaultModel || config.tokens) {
    showConfig(config);
  }

  const modelSuggestions: Record<string, string> = {
    openai: "e.g. gpt-4o, gpt-4o-mini",
    anthropic: "e.g. claude-sonnet-4-5-20250929",
    ollama: "e.g. llama3, mistral, codellama",
    deepseek: "e.g. deepseek-chat, deepseek-reasoner",
    gemini: "e.g. gemini-2.5-flash, gemini-2.5-pro",
  };

  const answers = await p.group(
    {
      provider: () =>
        p.select({
          message: "Select your LLM provider:",
          options: VALID_PROVIDERS.map((v) => ({ value: v, label: v })),
          initialValue: config.defaultProvider ?? "openai",
        }),
      token: ({ results }) => {
        if (results.provider === "ollama") return Promise.resolve("");
        const currentToken = config.tokens?.[results.provider!];
        const hint = currentToken ? ` [current: ${maskToken(currentToken)}]` : "";
        return p.password({
          message: `API key for ${results.provider}${hint}:`,
        });
      },
      model: async ({ results }) => {
        const provider = results.provider as string;
        const token = (results.token as string) || config.tokens?.[provider];

        // Try fetching models dynamically
        if (token || provider === "ollama") {
          try {
            const s = p.spinner();
            s.start("Fetching available models...");
            const llm = createProvider({ provider, apiKey: token || undefined });
            const models = await llm.listModels?.();
            s.stop("Models fetched.");

            if (models && models.length > 0) {
              const customValue = "__custom__";
              const choice = await p.select({
                message: "Select default model:",
                options: [
                  ...models.map((m) => ({ value: m, label: m })),
                  { value: customValue, label: "Custom model..." },
                ],
                initialValue: config.defaultModel ?? models[0],
              });

              if (choice === customValue) {
                return p.text({
                  message: "Enter custom model name:",
                  placeholder: modelSuggestions[provider] ?? "",
                  defaultValue: config.defaultModel ?? "",
                });
              }
              return Promise.resolve(choice as string);
            }
          } catch {
            // Fall back to text input on failure
          }
        }

        return p.text({
          message: "Default model (press Enter to skip):",
          placeholder: modelSuggestions[provider] ?? "",
          defaultValue: config.defaultModel ?? "",
        });
      },
    },
    {
      onCancel: () => {
        p.cancel("Cancelled.");
        process.exit(0);
      },
    },
  );

  const chosenProvider = answers.provider as string;
  if (answers.token) {
    config.tokens = config.tokens ?? {};
    config.tokens[chosenProvider] = answers.token as string;
  }
  if (answers.model) {
    config.defaultModel = answers.model as string;
  }

  // Smart default handling: don't blindly overwrite existing default
  const hadDefault = !!config.defaultProvider;
  if (!hadDefault) {
    // No existing default — set to chosen provider
    config.defaultProvider = chosenProvider;
  } else if (config.defaultProvider === chosenProvider) {
    // Same provider — no change needed
  } else if (!ctx.globalOpts.nonInteractive) {
    // Different provider selected — ask whether to switch default
    const switchDefault = await p.confirm({
      message: `Default provider is currently ${pc.bold(config.defaultProvider)}. Switch default to ${pc.bold(chosenProvider)}?`,
      initialValue: false,
    });
    if (!p.isCancel(switchDefault) && switchDefault) {
      config.defaultProvider = chosenProvider;
    }
  }

  saveConfig(config);
  p.log.success("Configuration saved.");
  showConfig(config);

  // Offer to configure another provider (interactive only)
  if (!ctx.globalOpts.nonInteractive) {
    const unconfigured = VALID_PROVIDERS.filter(
      (prov) => prov !== "ollama" && prov !== chosenProvider && !config.tokens?.[prov],
    );
    if (unconfigured.length > 0) {
      const addAnother = await p.confirm({
        message: "Configure another provider?",
        initialValue: false,
      });
      if (!p.isCancel(addAnother) && addAnother) {
        const nextProvider = await p.select({
          message: "Select provider:",
          options: unconfigured.map((v) => ({ value: v, label: v })),
        });
        if (!p.isCancel(nextProvider)) {
          const nextToken = await p.password({
            message: `API key for ${nextProvider}:`,
          });
          if (!p.isCancel(nextToken) && nextToken) {
            config.tokens = config.tokens ?? {};
            config.tokens[nextProvider as string] = nextToken as string;
            saveConfig(config);
            p.log.success(`Token saved for ${pc.bold(nextProvider as string)}.`);
          }
        }
      }
    }
  }
}
