import {
  OpenAIProvider,
  OllamaProvider,
  AnthropicProvider,
  DeepSeekProvider,
  GeminiProvider,
  GitHubCopilotProvider,
  LLMProvider,
  AgentRouter,
  ALL_SPECIALIST_CONFIGS,
  SpecialistConfig,
  CIDebugger,
  InfraDiffAnalyzer,
  withRetry,
} from "@dojops/core";
import { NoopProvider } from "./noop-provider";
import { DevOpsTool } from "@dojops/sdk";
import { createToolRegistry, ToolRegistry, discoverCustomAgents } from "@dojops/tool-registry";

export { createToolRegistry, ToolRegistry };

export interface ProviderOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  /** When true, returns a NoopProvider instead of throwing on missing API key */
  allowMissing?: boolean;
  ollamaHost?: string;
  ollamaTlsRejectUnauthorized?: boolean;
}

export function createProvider(options?: ProviderOptions): LLMProvider {
  const providerName = options?.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
  const model = options?.model ?? process.env.DOJOPS_MODEL;

  const allowMissing = options?.allowMissing ?? false;

  if (providerName === "ollama") {
    const baseUrl = options?.ollamaHost ?? process.env.OLLAMA_HOST ?? undefined;
    const rejectUnauthorized = options?.ollamaTlsRejectUnauthorized;
    return withRetry(new OllamaProvider(baseUrl, model, undefined, rejectUnauthorized));
  } else if (providerName === "anthropic") {
    const key = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      if (allowMissing) {
        console.warn("[dojops] Anthropic API key not configured — using NoopProvider");
        return new NoopProvider(
          `Anthropic API key not configured. Set ANTHROPIC_API_KEY or run: dojops auth login --provider anthropic`,
        );
      }
      throw new Error(
        "Anthropic API key is required. Set ANTHROPIC_API_KEY or run: dojops login --token <KEY> --provider anthropic",
      );
    }
    return withRetry(new AnthropicProvider(key, model));
  } else if (providerName === "deepseek") {
    const key = options?.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) {
      if (allowMissing) {
        console.warn("[dojops] DeepSeek API key not configured — using NoopProvider");
        return new NoopProvider(
          `DeepSeek API key not configured. Set DEEPSEEK_API_KEY or run: dojops auth login --provider deepseek`,
        );
      }
      throw new Error(
        "DeepSeek API key is required. Set DEEPSEEK_API_KEY or run: dojops login --token <KEY> --provider deepseek",
      );
    }
    return withRetry(new DeepSeekProvider(key, model));
  } else if (providerName === "gemini") {
    const key = options?.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) {
      if (allowMissing) {
        console.warn("[dojops] Gemini API key not configured — using NoopProvider");
        return new NoopProvider(
          `Gemini API key not configured. Set GEMINI_API_KEY or run: dojops auth login --provider gemini`,
        );
      }
      throw new Error(
        "Gemini API key is required. Set GEMINI_API_KEY or run: dojops login --token <KEY> --provider gemini",
      );
    }
    return withRetry(new GeminiProvider(key, model));
  } else if (providerName === "github-copilot") {
    // No API key needed — auth managed via OAuth Device Flow
    // getValidCopilotToken() handles JWT refresh internally
    return withRetry(new GitHubCopilotProvider(model));
  } else {
    const key = options?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      if (allowMissing) {
        console.warn("[dojops] OpenAI API key not configured — using NoopProvider");
        return new NoopProvider(
          `OpenAI API key not configured. Set OPENAI_API_KEY or run: dojops auth login --provider openai`,
        );
      }
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY or run: dojops login --token <KEY> --provider openai",
      );
    }
    return withRetry(new OpenAIProvider(key, model));
  }
}

/**
 * Creates all DevOps tools. Uses tool-registry to instantiate all 12 built-in tools
 * plus any discovered plugin tools.
 *
 * @param provider - LLM provider for tool generation
 * @param projectPath - Optional project path for plugin discovery
 * @param docAugmenter - Optional documentation augmenter for tool prompts
 */
export function createTools(
  provider: LLMProvider,
  projectPath?: string,
  docAugmenter?: { augmentPrompt(s: string, kw: string[], q: string): Promise<string> },
): DevOpsTool[] {
  return createToolRegistry(provider, projectPath, { docAugmenter }).getAll();
}

export interface CreateRouterResult {
  router: AgentRouter;
  customAgentNames: Set<string>;
}

export function createRouter(
  provider: LLMProvider,
  projectPath?: string,
  docAugmenter?: { augmentPrompt(s: string, kw: string[], q: string): Promise<string> },
): CreateRouterResult {
  const customAgents = discoverCustomAgents(projectPath);
  const customConfigs: SpecialistConfig[] = customAgents.map((entry) => ({
    name: entry.config.name,
    domain: entry.config.domain,
    description: entry.config.description,
    systemPrompt: entry.config.systemPrompt,
    keywords: entry.config.keywords,
  }));

  // Merge: custom agents can override built-in by name
  const configMap = new Map<string, SpecialistConfig>();
  for (const config of ALL_SPECIALIST_CONFIGS) {
    configMap.set(config.name, config);
  }
  const customAgentNames = new Set<string>();
  for (const config of customConfigs) {
    configMap.set(config.name, config);
    customAgentNames.add(config.name);
  }

  const router = new AgentRouter(provider, Array.from(configMap.values()), docAugmenter);
  return { router, customAgentNames };
}

export function createDebugger(provider: LLMProvider): CIDebugger {
  return new CIDebugger(provider);
}

export function createDiffAnalyzer(provider: LLMProvider): InfraDiffAnalyzer {
  return new InfraDiffAnalyzer(provider);
}
