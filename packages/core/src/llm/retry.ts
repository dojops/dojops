import crypto from "node:crypto";
import { LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";
import { JsonValidationError } from "./json-validator";
import { redactSecrets } from "./redact";

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
    lower.includes("internal server error") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable") ||
    /\bstatus\s*(code\s*)?5\d\d\b/.test(lower) ||
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

function throwRedactedError(err: unknown): never {
  if (err instanceof Error) {
    const redacted = redactSecrets(err.message);
    if (redacted !== err.message) throw new Error(redacted, { cause: err });
  }
  throw err;
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
      let currentRequest = request;
      // Hard cap prevents infinite loops if schemaRetries is misconfigured
      const maxTotalAttempts = maxRetries + schemaRetries + 1;
      let totalAttempts = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (++totalAttempts > maxTotalAttempts) break;

        try {
          return await provider.generate(currentRequest);
        } catch (err) {
          lastError = err;

          if (handleSchemaRetry(currentRequest, err)) {
            schemaAttempt++;
            currentRequest = buildStricterRequest(currentRequest, err as JsonValidationError);
            attempt--; // Don't count schema retry against network budget
            await sleep(500);
            continue;
          }

          if (attempt < maxRetries && isRetryableError(err)) {
            const jitter = crypto.randomInt(500);
            const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
            await sleep(delay);
            continue;
          }

          throwRedactedError(err);
        }
      }
      throw lastError;

      function handleSchemaRetry(req: LLMRequest, err: unknown): boolean {
        return !!req.schema && isSchemaValidationError(err) && schemaAttempt < schemaRetries;
      }

      function buildStricterRequest(
        req: LLMRequest,
        validationErr: JsonValidationError,
      ): LLMRequest {
        const stricterSystem =
          `${req.system ?? ""}\n\nIMPORTANT: Your previous response failed JSON schema validation: ${validationErr.message}. You MUST respond with valid JSON that matches the required schema exactly. No markdown fences, no extra text outside JSON.`.trim();
        return { ...req, system: stricterSystem };
      }
    },

    generateStream: provider.generateStream
      ? async (request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> => {
          let lastError: unknown;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              // Retry only on the initial call, not mid-stream
              return await provider.generateStream!(request, onChunk);
            } catch (err) {
              lastError = err;
              if (attempt < maxRetries && isRetryableError(err)) {
                const jitter = crypto.randomInt(500);
                const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
                await sleep(delay);
                continue;
              }
              throwRedactedError(err);
            }
          }
          throw lastError;
        }
      : undefined,

    generateWithTools: provider.generateWithTools
      ? async (request: LLMToolRequest): Promise<LLMToolResponse> => {
          let lastError: unknown;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              return await provider.generateWithTools!(request);
            } catch (err) {
              lastError = err;
              if (attempt < maxRetries && isRetryableError(err)) {
                const jitter = crypto.randomInt(500);
                const delay = Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
                await sleep(delay);
                continue;
              }
              throwRedactedError(err);
            }
          }
          throw lastError;
        }
      : undefined,

    listModels: provider.listModels ? () => provider.listModels!() : undefined,
  };
}
