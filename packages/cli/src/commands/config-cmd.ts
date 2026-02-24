import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  validateProvider,
  VALID_PROVIDERS,
  OdaConfig,
} from "../config";
import { CLIContext } from "../types";
import { maskToken } from "../formatter";
import { extractFlagValue } from "../parser";
import { createProvider } from "@dojops/api";

function showConfig(config: OdaConfig): void {
  const lines = [
    `${pc.bold("Provider:")}  ${config.defaultProvider ?? pc.dim("(not set)")}`,
    `${pc.bold("Model:")}     ${config.defaultModel ?? pc.dim("(not set)")}`,
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
  // dojops config show
  if (args[0] === "show" || args.includes("--show")) {
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

  // dojops config profile <subcommand> — handled in Phase 6
  if (args[0] === "profile") {
    const { configProfileCommand } = await import("./config-profile");
    return configProfileCommand(args.slice(1), ctx);
  }

  const providerFlag = extractFlagValue(args, "--provider") ?? ctx.globalOpts.provider;
  const tokenFlag = extractFlagValue(args, "--token");
  const modelFlag = extractFlagValue(args, "--model") ?? ctx.globalOpts.model;

  // Direct flags mode
  if (providerFlag || tokenFlag || modelFlag) {
    const config = loadConfig();

    if (providerFlag) {
      try {
        validateProvider(providerFlag);
      } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
      }
      config.defaultProvider = providerFlag;
    }

    if (tokenFlag) {
      const provider = providerFlag ?? config.defaultProvider ?? "openai";
      if (provider === "ollama") {
        p.log.error("Ollama runs locally and does not require an API token.");
        process.exit(1);
      }
      config.tokens = config.tokens ?? {};
      config.tokens[provider] = tokenFlag;
    }

    if (modelFlag) {
      config.defaultModel = modelFlag;
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

  config.defaultProvider = answers.provider as string;
  if (answers.token) {
    config.tokens = config.tokens ?? {};
    config.tokens[answers.provider as string] = answers.token as string;
  }
  if (answers.model) {
    config.defaultModel = answers.model as string;
  }

  saveConfig(config);
  p.log.success("Configuration saved.");
  showConfig(config);
}
