import { LLMProvider, LLMRequest, LLMResponse } from "./provider";

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
