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
  DevSecOpsReviewer,
  withRetry,
} from "@dojops/core";
import { NoopProvider } from "./noop-provider";
import { DevOpsSkill } from "@dojops/sdk";
export { createSkillRegistry, SkillRegistry } from "@dojops/skill-registry";
import { createSkillRegistry, discoverCustomAgents } from "@dojops/skill-registry";

export interface ProviderOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  /** When true, returns a NoopProvider instead of throwing on missing API key */
  allowMissing?: boolean;
  ollamaHost?: string;
  ollamaTlsRejectUnauthorized?: boolean;
}

/** Resolve API key, returning it or null when missing and allowMissing is true. Throws on missing + !allowMissing. */
function resolveApiKey(
  providerName: string,
  envVar: string,
  apiKey: string | undefined,
  allowMissing: boolean,
): string | null {
  const key = apiKey ?? process.env[envVar];
  if (key) return key;
  if (allowMissing) {
    console.warn(`[dojops] ${providerName} API key not configured — using NoopProvider`);
    return null;
  }
  throw new Error(
    `${providerName} API key is required. Set ${envVar} or run: dojops login --token <KEY> --provider ${providerName.toLowerCase()}`,
  );
}

/** Provider factory dispatch map — keyed constructors for each supported provider. */
function buildKeyedProvider(
  providerName: string,
  model: string | undefined,
  options: ProviderOptions | undefined,
  allowMissing: boolean,
): LLMProvider {
  if (providerName === "ollama") {
    const baseUrl = options?.ollamaHost ?? process.env.OLLAMA_HOST ?? undefined;
    return withRetry(
      new OllamaProvider(baseUrl, model, undefined, options?.ollamaTlsRejectUnauthorized),
    );
  }

  if (providerName === "github-copilot") {
    return withRetry(new GitHubCopilotProvider(model));
  }

  const providerConfigs: Record<
    string,
    { envVar: string; ctor: new (key: string, model?: string) => LLMProvider }
  > = {
    anthropic: { envVar: "ANTHROPIC_API_KEY", ctor: AnthropicProvider },
    deepseek: { envVar: "DEEPSEEK_API_KEY", ctor: DeepSeekProvider },
    gemini: { envVar: "GEMINI_API_KEY", ctor: GeminiProvider },
  };

  const config = providerConfigs[providerName];
  const envVar = config?.envVar ?? "OPENAI_API_KEY";
  const Ctor = config?.ctor ?? OpenAIProvider;
  const displayNames: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    gemini: "Gemini",
  };
  const displayName =
    displayNames[providerName] ?? providerName.charAt(0).toUpperCase() + providerName.slice(1);

  const key = resolveApiKey(displayName, envVar, options?.apiKey, allowMissing);
  if (!key) {
    return new NoopProvider(
      `${displayName} API key not configured. Set ${envVar} or run: dojops auth login --provider ${providerName.toLowerCase()}`,
    );
  }
  return withRetry(new Ctor(key, model));
}

export function createProvider(options?: ProviderOptions): LLMProvider {
  const providerName = options?.provider ?? process.env.DOJOPS_PROVIDER ?? "openai";
  const model = options?.model || process.env.DOJOPS_MODEL || undefined;
  const allowMissing = options?.allowMissing ?? false;

  return buildKeyedProvider(providerName, model, options, allowMissing);
}

/** Duck-typed DocProvider for v2 .dops skills (avoids hard import on @dojops/context) */
interface DocProvider {
  resolveLibrary(name: string, query: string): Promise<{ id: string; name: string } | null>;
  queryDocs(libraryId: string, query: string): Promise<string>;
}

/**
 * Creates all DevOps skills. Uses module-registry to instantiate all 13 built-in skills
 * plus any discovered custom skills.
 *
 * @param provider - LLM provider for tool generation
 * @param projectPath - Optional project path for plugin discovery
 * @param docAugmenter - Optional documentation augmenter for tool prompts
 * @param context7Provider - Optional Context7 DocProvider for v2 .dops skills
 * @param projectContext - Optional project context string for v2 .dops skills
 */
export function createTools(
  provider: LLMProvider,
  projectPath?: string,
  docAugmenter?: { augmentPrompt(s: string, kw: string[], q: string): Promise<string> },
  context7Provider?: DocProvider,
  projectContext?: string,
): DevOpsSkill[] {
  return createSkillRegistry(provider, projectPath, {
    docAugmenter,
    context7Provider,
    projectContext,
  }).getAll();
}

export interface CreateRouterResult {
  router: AgentRouter;
  customAgentNames: Set<string>;
}

export function createRouter(
  provider: LLMProvider,
  projectPath?: string,
  docAugmenter?: { augmentPrompt(s: string, kw: string[], q: string): Promise<string> },
  skipCustomConfigs?: boolean,
): CreateRouterResult {
  const customAgents = skipCustomConfigs ? [] : discoverCustomAgents(projectPath);
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

export function createReviewer(provider: LLMProvider): DevSecOpsReviewer {
  return new DevSecOpsReviewer(provider);
}
