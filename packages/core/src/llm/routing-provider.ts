/**
 * RoutingProvider — per-request model routing decorator.
 *
 * Wraps any LLMProvider and swaps the underlying model before each call
 * based on prompt complexity classification from model-router.ts.
 * Caches tier-specific provider instances for reuse.
 */

import type { LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";
import {
  routeModel,
  getModelForTier,
  type ModelRouteResult,
  type TierName,
  type TaskComplexity,
} from "./model-router";

export interface RoutingProviderOptions {
  /** Factory that creates a provider for a specific model name. */
  providerFactory: (model: string) => LLMProvider;
  /** Hint passed to classifyTaskComplexity — e.g. the matched skill name. */
  skillHint?: string;
  /** Override detection: always use this tier. */
  forceTier?: TierName;
  /** Callback invoked after each routing decision (for logging/learning). */
  onRoute?: (result: ModelRouteResult, request: LLMRequest) => void;
  /** Query function that returns the historically best model for a skill. */
  learningFn?: (skillName: string) => { model: string; tier: TierName } | null;
}

export class RoutingProvider implements LLMProvider {
  readonly name: string;
  private readonly tierProviders = new Map<string, LLMProvider>();

  constructor(
    private readonly inner: LLMProvider,
    private readonly options: RoutingProviderOptions,
  ) {
    this.name = inner.name;
  }

  private getProviderForModel(model: string): LLMProvider {
    let provider = this.tierProviders.get(model);
    if (!provider) {
      provider = this.options.providerFactory(model);
      this.tierProviders.set(model, provider);
    }
    return provider;
  }

  private route(request: LLMRequest): { provider: LLMProvider; routeResult: ModelRouteResult } {
    // Check learned preferences first
    if (this.options.learningFn && this.options.skillHint) {
      const learned = this.options.learningFn(this.options.skillHint);
      if (learned) {
        const result: ModelRouteResult = {
          model: learned.model,
          tier: learned.tier,
          complexity: "moderate" as TaskComplexity, // learning overrides heuristic
        };
        this.options.onRoute?.(result, request);
        return { provider: this.getProviderForModel(learned.model), routeResult: result };
      }
    }

    // Heuristic routing
    const prompt = request.prompt || request.messages?.map((m) => m.content).join(" ") || "";
    const result = routeModel(this.inner.name, prompt, {
      skillName: this.options.skillHint,
      isStructuredOutput: !!request.schema,
    });

    if (this.options.forceTier) {
      result.tier = this.options.forceTier;
      result.model = getModelForTier(this.inner.name, this.options.forceTier);
    }

    this.options.onRoute?.(result, request);
    return { provider: this.getProviderForModel(result.model), routeResult: result };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const { provider } = this.route(request);
    return provider.generate(request);
  }

  async generateStream?(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    const { provider } = this.route(request);
    if (!provider.generateStream) {
      return provider.generate(request);
    }
    return provider.generateStream(request, onChunk);
  }

  async generateWithTools?(request: LLMToolRequest): Promise<LLMToolResponse> {
    // Tool requests carry the prompt in messages — extract for classification
    const prompt =
      request.messages?.map((m) => (typeof m.content === "string" ? m.content : "")).join(" ") ??
      "";
    const syntheticRequest: LLMRequest = { prompt, schema: undefined };
    const { provider } = this.route(syntheticRequest);
    if (!provider.generateWithTools) {
      throw new Error(`Provider "${provider.name}" does not support tool calling`);
    }
    return provider.generateWithTools(request);
  }

  listModels?(): Promise<string[]> {
    return this.inner.listModels?.() ?? Promise.resolve([]);
  }
}
