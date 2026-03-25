import { LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";

// ---------------------------------------------------------------------------
// Circuit breaker: skip providers that have failed repeatedly
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

/** Consecutive failures before opening the circuit. */
const CB_FAILURE_THRESHOLD = 3;
/** Milliseconds before an open circuit transitions to half-open. */
const CB_RESET_MS = 60_000;

/**
 * Multi-provider fallback with per-provider circuit breaker.
 * Tries each provider in order until one succeeds.
 * Providers that fail repeatedly are temporarily skipped (circuit open).
 */
export class FallbackProvider implements LLMProvider {
  readonly name: string;
  private readonly circuits = new Map<number, CircuitState>();

  constructor(private readonly providers: LLMProvider[]) {
    if (providers.length === 0) {
      throw new Error("FallbackProvider requires at least one provider");
    }
    this.name = `fallback(${providers.map((p) => p.name).join(",")})`;
  }

  /** Check if a provider's circuit allows a request. Transitions open→half-open when reset timer expires. */
  private isCircuitOpen(index: number): boolean {
    const circuit = this.circuits.get(index);
    if (!circuit || circuit.state === "closed") return false;
    if (circuit.state === "half-open") return false; // allow one probe request

    // State is "open" — check if reset timer has expired
    if (Date.now() - circuit.lastFailure >= CB_RESET_MS) {
      circuit.state = "half-open";
      return false; // allow one probe request
    }
    return true; // still open, skip this provider
  }

  /** Record a successful request — reset circuit to closed. */
  private recordSuccess(index: number): void {
    const circuit = this.circuits.get(index);
    if (circuit) {
      circuit.failures = 0;
      circuit.state = "closed";
    }
  }

  /** Record a failed request — increment failures, open circuit if threshold reached. */
  private recordFailure(index: number): void {
    let circuit = this.circuits.get(index);
    if (!circuit) {
      circuit = { failures: 0, lastFailure: 0, state: "closed" };
      this.circuits.set(index, circuit);
    }
    circuit.failures++;
    circuit.lastFailure = Date.now();
    if (circuit.failures >= CB_FAILURE_THRESHOLD) {
      circuit.state = "open";
    }
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      if (this.isCircuitOpen(i)) continue;
      const provider = this.providers[i];
      try {
        const response = await provider.generate(request);
        this.recordSuccess(i);
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
        this.recordFailure(i);
        lastError = err;
      }
    }
    throw lastError ?? new Error("All providers failed");
  }

  async generateStream(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    let lastError: unknown;
    let chunksEmitted = false;
    for (let i = 0; i < this.providers.length; i++) {
      if (this.isCircuitOpen(i)) continue;
      const provider = this.providers[i];
      try {
        let response: LLMResponse;
        if (provider.generateStream) {
          response = await provider.generateStream(request, (chunk) => {
            chunksEmitted = true;
            onChunk(chunk);
          });
        } else {
          // Provider lacks streaming — fall back to non-streaming
          response = await provider.generate(request);
          chunksEmitted = true;
          onChunk(response.content);
        }
        this.recordSuccess(i);
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
        this.recordFailure(i);
        lastError = err;
        // If chunks were already emitted, the stream is corrupted — don't retry
        if (chunksEmitted) {
          throw err;
        }
      }
    }
    throw lastError ?? new Error("All providers failed");
  }

  async generateWithTools(request: LLMToolRequest): Promise<LLMToolResponse> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i++) {
      if (this.isCircuitOpen(i)) continue;
      const provider = this.providers[i];
      if (!provider.generateWithTools) continue;
      try {
        const response = await provider.generateWithTools(request);
        this.recordSuccess(i);
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
        this.recordFailure(i);
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
