import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  validateProvider,
  resolveProvider,
  getActiveProfile,
  VALID_PROVIDERS,
  DojOpsConfig,
} from "../config";
import { CLIContext } from "../types";
import { maskToken } from "../formatter";
import { extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { createProvider } from "@dojops/api";
import { isCopilotAuthenticated, copilotLogin } from "@dojops/core";

function showConfig(config: DojOpsConfig): void {
  // UX #10: Show effective provider (including env var override) if it differs from config
  const effectiveProvider = resolveProvider(undefined, config);
  const envOverrideLabel = pc.yellow(
    `(env: DOJOPS_PROVIDER=${process.env.DOJOPS_PROVIDER} → ${effectiveProvider})`,
  );
  const providerDisplay =
    process.env.DOJOPS_PROVIDER && process.env.DOJOPS_PROVIDER !== config.defaultProvider
      ? `${config.defaultProvider ?? pc.dim("(not set)")} ${envOverrideLabel}`
      : (config.defaultProvider ?? pc.dim("(not set)"));
  const lines = [
    `${pc.bold("Provider:")}  ${providerDisplay}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
    `${pc.bold("Temperature:")} ${config.defaultTemperature == null ? pc.dim("(not set)") : String(config.defaultTemperature)}`,
    `${pc.bold("Ollama host:")} ${config.ollamaHost ?? pc.dim("(default)")}`,
    `${pc.bold("Tokens:")}`,
    `  openai:          ${maskToken(config.tokens?.openai)}`,
    `  anthropic:       ${maskToken(config.tokens?.anthropic)}`,
    `  deepseek:        ${maskToken(config.tokens?.deepseek)}`,
    `  gemini:          ${maskToken(config.tokens?.gemini)}`,
    `  ollama:          ${pc.dim("(no token needed)")}`,
    `  github-copilot:  ${isCopilotAuthenticated() ? pc.green("authenticated") + " " + pc.dim("(OAuth)") : pc.dim("(not set)")}`,
  ];

  // Show environment variable tokens (not visible via config file)
  const envVars: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const envLines: string[] = [];
  for (const [provider, envKey] of Object.entries(envVars)) {
    if (process.env[envKey]) {
      envLines.push(`  ${provider}: ${maskToken(process.env[envKey])} ${pc.dim("(env)")}`);
    }
  }
  if (envLines.length > 0) {
    lines.push(`${pc.bold("Env tokens:")}`, ...envLines);
  }

  const activeProfile = getActiveProfile();
  const configPathDim = pc.dim(`(${getConfigPath()})`);
  const title = activeProfile
    ? `Configuration ${configPathDim} ${pc.yellow(`[profile: ${activeProfile}]`)}`
    : `Configuration ${configPathDim}`;
  p.note(lines.join("\n"), title);
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
      if (provider === "ollama" || provider === "github-copilot") {
        throw new CLIError(
          ExitCode.VALIDATION_ERROR,
          provider === "ollama"
            ? "Ollama runs locally and does not require an API token."
            : "GitHub Copilot uses OAuth Device Flow. Run: dojops auth login --provider github-copilot",
        );
      }
      config.tokens = config.tokens ?? {};
      config.tokens[provider] = tokenFlag;
    }

    if (modelFlag) {
      config.defaultModel = modelFlag;
    }

    if (temperatureFlag) {
      const temp = Number.parseFloat(temperatureFlag);
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
    "github-copilot": "e.g. gpt-4o, claude-3.5-sonnet, o1-mini",
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
        if (results.provider === "ollama" || results.provider === "github-copilot")
          return Promise.resolve("");
        const currentToken = config.tokens?.[results.provider!];
        const hint = currentToken ? ` [current: ${maskToken(currentToken)}]` : "";
        return p.password({
          message: `API key for ${results.provider}${hint}:`,
        });
      },
      ollamaHost: ({ results }) => {
        if (results.provider !== "ollama") return Promise.resolve("");
        return p.text({
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
      },
      ollamaTls: ({ results }) => {
        const host = results.ollamaHost as string;
        if (!host || !host.startsWith("https://")) return Promise.resolve(true);
        return p.confirm({
          message: "Verify TLS certificates? (disable for self-signed certs)",
          initialValue: config.ollamaTlsRejectUnauthorized ?? true,
        });
      },
      model: async ({ results }) => {
        const provider = results.provider as string;
        const token = (results.token as string) || config.tokens?.[provider];

        // GitHub Copilot: run OAuth Device Flow if needed before fetching models
        if (provider === "github-copilot" && !isCopilotAuthenticated()) {
          const cs = p.spinner();
          cs.start("Starting GitHub Copilot OAuth Device Flow...");
          await copilotLogin({
            onDeviceCode: (userCode, verificationUri) => {
              cs.stop("Device code received.");
              p.note(
                [
                  `Code: ${pc.bold(pc.cyan(userCode))}`,
                  `URL:  ${pc.underline(verificationUri)}`,
                  "",
                  "Open the URL above and paste the code to authorize DojOps.",
                ].join("\n"),
                "GitHub Device Authorization",
              );
              cs.start("Waiting for authorization...");
            },
            onStatus: (msg) => cs.message(msg),
          });
          cs.stop("Authenticated with GitHub Copilot.");
        }

        // Try fetching models dynamically
        if (token || provider === "ollama" || provider === "github-copilot") {
          try {
            const isStructured = ctx.globalOpts.output !== "table";
            const s = p.spinner();
            if (!isStructured) s.start("Fetching available models...");
            const ollamaHost = (results.ollamaHost as string) || undefined;
            const ollamaTls = results.ollamaTls as boolean | undefined;
            const llm = createProvider({
              provider,
              apiKey: token || undefined,
              ollamaHost,
              ollamaTlsRejectUnauthorized: ollamaTls === false ? false : undefined,
            });
            const models = await llm.listModels?.();
            if (!isStructured) s.stop("Models fetched.");

            if (models?.length) {
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

  // Persist Ollama host settings
  if (chosenProvider === "ollama") {
    const host = answers.ollamaHost as string;
    if (host && host !== "http://localhost:11434") {
      config.ollamaHost = host;
    } else {
      delete config.ollamaHost;
    }
    const tls = answers.ollamaTls;
    if (tls === false) {
      config.ollamaTlsRejectUnauthorized = false;
    } else {
      delete config.ollamaTlsRejectUnauthorized;
    }
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
      (prov) =>
        prov !== "ollama" &&
        prov !== "github-copilot" &&
        prov !== chosenProvider &&
        !config.tokens?.[prov],
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
