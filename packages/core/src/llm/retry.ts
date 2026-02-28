import { LLMProvider, LLMRequest, LLMResponse } from "./provider";
import { JsonValidationError } from "./json-validator";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Max retries for schema validation failures (default: 1) */
  schemaRetries?: number;
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("overloaded") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("internal server error") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up")
  );
}

function isSchemaValidationError(err: unknown): boolean {
  return err instanceof JsonValidationError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an LLMProvider with automatic retry + exponential backoff.
 * Retries on 429/5xx/transient network errors.
 * Also retries once on schema validation failure with a stricter prompt.
 */
export function withRetry(provider: LLMProvider, options?: RetryOptions): LLMProvider {
  const maxRetries = options?.maxRetries ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 10000;
  const schemaRetries = options?.schemaRetries ?? 1;

  return {
    name: provider.name,

    async generate(request: LLMRequest): Promise<LLMResponse> {
      let lastError: unknown;
      let schemaAttempt = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await provider.generate(request);
        } catch (err) {
          lastError = err;

          // Schema validation retry: re-send with stricter instructions
          // Schema retries do NOT count against the network retry budget
          if (request.schema && isSchemaValidationError(err) && schemaAttempt < schemaRetries) {
            schemaAttempt++;
            const validationErr = err as JsonValidationError;
            const stricterSystem =
              `${request.system ?? ""}\n\nIMPORTANT: Your previous response failed JSON schema validation: ${validationErr.message}. You MUST respond with valid JSON that matches the required schema exactly. No markdown fences, no extra text outside JSON.`.trim();
            request = { ...request, system: stricterSystem };
            attempt--; // Don't count schema retry against network budget
            await sleep(500);
            continue;
          }

          if (attempt < maxRetries && isRetryableError(err)) {
            const jitter = Math.random() * 500;
            const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
            await sleep(delay);
            continue;
          }
          throw err;
        }
      }
      throw lastError;
    },

    listModels: provider.listModels ? () => provider.listModels!() : undefined,
  };
}
