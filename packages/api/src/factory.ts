import {
  OpenAIProvider,
  OllamaProvider,
  AnthropicProvider,
  DeepSeekProvider,
  GeminiProvider,
  LLMProvider,
  AgentRouter,
  ALL_SPECIALIST_CONFIGS,
  SpecialistConfig,
  CIDebugger,
  InfraDiffAnalyzer,
} from "@dojops/core";
import { DevOpsTool } from "@dojops/sdk";
import { createToolRegistry, ToolRegistry, discoverCustomAgents } from "@dojops/tool-registry";

export { createToolRegistry, ToolRegistry };

export interface ProviderOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
}

export function createProvider(options?: ProviderOptions): LLMProvider {
  const providerName = options?.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
  const model = options?.model ?? process.env.DOJOPS_MODEL;

  if (providerName === "ollama") {
    return new OllamaProvider(undefined, model);
  } else if (providerName === "anthropic") {
    const key = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "Anthropic API key is required. Set ANTHROPIC_API_KEY or run: dojops login --token <KEY> --provider anthropic",
      );
    }
    return new AnthropicProvider(key, model);
  } else if (providerName === "deepseek") {
    const key = options?.apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) {
      throw new Error(
        "DeepSeek API key is required. Set DEEPSEEK_API_KEY or run: dojops login --token <KEY> --provider deepseek",
      );
    }
    return new DeepSeekProvider(key, model);
  } else if (providerName === "gemini") {
    const key = options?.apiKey ?? process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error(
        "Gemini API key is required. Set GEMINI_API_KEY or run: dojops login --token <KEY> --provider gemini",
      );
    }
    return new GeminiProvider(key, model);
  } else {
    const key = options?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY or run: dojops login --token <KEY> --provider openai",
      );
    }
    return new OpenAIProvider(key, model);
  }
}

/**
 * Creates all DevOps tools. Uses tool-registry to instantiate all 12 built-in tools
 * plus any discovered plugin tools.
 *
 * @param provider - LLM provider for tool generation
 * @param projectPath - Optional project path for plugin discovery
 */
export function createTools(provider: LLMProvider, projectPath?: string): DevOpsTool[] {
  return createToolRegistry(provider, projectPath).getAll();
}

export interface CreateRouterResult {
  router: AgentRouter;
  customAgentNames: Set<string>;
}

export function createRouter(provider: LLMProvider, projectPath?: string): CreateRouterResult {
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

  const router = new AgentRouter(provider, Array.from(configMap.values()));
  return { router, customAgentNames };
}

export function createDebugger(provider: LLMProvider): CIDebugger {
  return new CIDebugger(provider);
}

export function createDiffAnalyzer(provider: LLMProvider): InfraDiffAnalyzer {
  return new InfraDiffAnalyzer(provider);
}
