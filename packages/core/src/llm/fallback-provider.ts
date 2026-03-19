import { LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";

/**
 * Multi-provider fallback: tries each provider in order until one succeeds.
 * If all providers fail, throws the last error encountered.
 */
export class FallbackProvider implements LLMProvider {
  readonly name: string;

  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackProvider requires at least one provider");
    }
    this.name = `fallback(${providers.map((p) => p.name).join(",")})`;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        const response = await provider.generate(request);
        if (i > 0) {
          const failed = this.providers
            .slice(0, i)
            .map((p) => p.name)
            .join(", ");
          console.warn(
            `[dojops] Primary provider(s) failed (${failed}). Using fallback: ${provider.name}`,
          );
        }
        return response;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("All providers failed");
  }

  async generateStream(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      try {
        let response: LLMResponse;
        if (provider.generateStream) {
          response = await provider.generateStream(request, onChunk);
        } else {
          // Provider lacks streaming — fall back to non-streaming
          response = await provider.generate(request);
          onChunk(response.content);
        }
        if (i > 0) {
          const failed = this.providers
            .slice(0, i)
            .map((p) => p.name)
            .join(", ");
          console.warn(
            `[dojops] Primary provider(s) failed (${failed}). Using fallback: ${provider.name}`,
          );
        }
        return response;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("All providers failed");
  }

  async generateWithTools(request: LLMToolRequest): Promise<LLMToolResponse> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      if (!provider.generateWithTools) continue;
      try {
        const response = await provider.generateWithTools(request);
        if (i > 0) {
          const failed = this.providers
            .slice(0, i)
            .map((p) => p.name)
            .join(", ");
          console.warn(
            `[dojops] Primary provider(s) failed (${failed}). Using fallback: ${provider.name}`,
          );
        }
        return response;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("All providers failed (generateWithTools)");
  }

  async listModels(): Promise<string[]> {
    for (const provider of this.providers) {
      if (provider.listModels) {
        try {
          return await provider.listModels();
        } catch {
          // Continue to next provider
        }
      }
    }
    return [];
  }
}
