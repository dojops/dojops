import { LLMProvider, LLMRequest, LLMResponse } from "./provider";

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

  async listModels(): Promise<string[]> {
    if (this.inner.listModels) {
      return this.inner.listModels();
    }
    return [];
  }
}
