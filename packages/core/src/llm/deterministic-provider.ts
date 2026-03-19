import { LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";

/**
 * A thin LLMProvider proxy that forces temperature=0 on every generate() call.
 * Used by `--replay` mode to enforce deterministic (bit-for-bit) reproducibility.
 */
export class DeterministicProvider implements LLMProvider {
  name: string;
  private readonly inner: LLMProvider;

  constructor(inner: LLMProvider) {
    this.inner = inner;
    this.name = inner.name;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    return this.inner.generate({ ...request, temperature: 0 });
  }

  async generateStream(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    if (!this.inner.generateStream) {
      // Fall back to non-streaming generate
      const response = await this.generate(request);
      onChunk(response.content);
      return response;
    }
    return this.inner.generateStream({ ...request, temperature: 0 }, onChunk);
  }

  async generateWithTools(request: LLMToolRequest): Promise<LLMToolResponse> {
    if (!this.inner.generateWithTools) {
      throw new Error(`Provider "${this.inner.name}" does not support tool calling`);
    }
    return this.inner.generateWithTools({ ...request, temperature: 0 });
  }

  async listModels(): Promise<string[]> {
    if (this.inner.listModels) {
      return this.inner.listModels();
    }
    return [];
  }
}
