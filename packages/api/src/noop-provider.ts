import type { LLMProvider, LLMRequest, LLMResponse } from "@dojops/core";

/**
 * A stub LLM provider that defers failure to generate() time.
 * Allows the API server to start without an API key — non-LLM endpoints
 * (health, agents, history, metrics, scan) work normally.
 */
export class NoopProvider implements LLMProvider {
  name = "noop";

  private readonly message: string;

  constructor(message?: string) {
    this.message =
      message ??
      "No LLM API key configured. Set the appropriate API key environment variable or run: dojops auth login";
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generate(_request: LLMRequest): Promise<LLMResponse> {
    throw new Error(this.message);
  }
}
