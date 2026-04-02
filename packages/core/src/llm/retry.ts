import crypto from "node:crypto";
import { LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";
import { JsonValidationError } from "./json-validator";
import { redactSecrets } from "./redact";
import { classifyProviderError } from "./provider-errors";
import { isStaleConnectionError, formatNetworkError } from "./network-hints";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Max retries for schema validation failures (default: 1) */
  schemaRetries?: number;
}

export class OverloadedExhaustedError extends Error {
  constructor(
    message: string,
    public readonly cause: Error,
  ) {
    super(message);
    this.name = "OverloadedExhaustedError";
  }
}

const MAX_OVERLOADED_CONSECUTIVE = 3;
const MAX_TOKENS_RECOVERY_ATTEMPTS = 3;

function isRetryableError(err: unknown): boolean {
  if (isStaleConnectionError(err)) return true;
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

function isOverloadedError(err: unknown): boolean {
  const msg = String(err).toLowerCase();
  return msg.includes("overloaded") || msg.includes("529") || msg.includes("capacity");
}

function isSchemaValidationError(err: unknown): boolean {
  return err instanceof JsonValidationError;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: Record<string, string> })?.headers;
  if (!headers) return undefined;

  const retryAfter = headers["retry-after"] ?? headers["Retry-After"];
  if (!retryAfter) return undefined;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 60_000);
  }

  const date = Date.parse(retryAfter);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 60_000);
  }

  return undefined;
}

function reduceMaxTokens(req: LLMRequest, err: unknown): LLMRequest | null {
  const msg = String(err);
  const match = msg.match(/(\d+)\s*\+\s*(\d+)\s*>\s*(\d+)/);
  if (match) {
    const inputTokens = parseInt(match[1], 10);
    const contextLimit = parseInt(match[3], 10);
    const available = contextLimit - inputTokens - 1000;
    if (available >= 1000) {
      return { ...req, maxTokens: available };
    }
  }
  if (req.maxTokens && req.maxTokens > 2000) {
    return { ...req, maxTokens: Math.floor(req.maxTokens / 2) };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throwRedactedError(err: unknown): never {
  if (err instanceof Error) {
    const withHints = formatNetworkError(err);
    const redacted = redactSecrets(withHints);
    if (redacted !== err.message) throw new Error(redacted, { cause: err });
  }
  throw err;
}

function computeDelay(
  err: unknown,
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
): number {
  const retryAfter = extractRetryAfterMs(err);
  if (retryAfter !== undefined) return retryAfter;
  const jitter = crypto.randomInt(500);
  return Math.min(initialDelayMs * Math.pow(2, attempt) + jitter, maxDelayMs);
}

/**
 * Wraps an LLMProvider with automatic retry + exponential backoff.
 * Retries on 429/5xx/transient network errors.
 * Also retries once on schema validation failure with a stricter prompt.
 */
export function withRetry(provider: LLMProvider, options?: RetryOptions): LLMProvider {
  const maxRetries = options?.maxRetries ?? 8;
  const initialDelayMs = options?.initialDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 32000;
  const schemaRetries = options?.schemaRetries ?? 1;

  return {
    name: provider.name,

    async generate(request: LLMRequest): Promise<LLMResponse> {
      let lastError: unknown;
      let schemaAttempt = 0;
      let consecutiveOverloaded = 0;
      let maxTokensRecoveryAttempt = 0;
      let currentRequest = request;
      // Hard cap prevents infinite loops if schemaRetries is misconfigured
      const maxTotalAttempts = maxRetries + schemaRetries + MAX_TOKENS_RECOVERY_ATTEMPTS + 1;
      let totalAttempts = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (++totalAttempts > maxTotalAttempts) break;

        try {
          const response = await provider.generate(currentRequest);
          consecutiveOverloaded = 0;
          return response;
        } catch (err) {
          lastError = err;

          if (isOverloadedError(err)) {
            consecutiveOverloaded++;
            if (consecutiveOverloaded >= MAX_OVERLOADED_CONSECUTIVE) {
              throw new OverloadedExhaustedError(
                `Provider overloaded after ${MAX_OVERLOADED_CONSECUTIVE} consecutive attempts`,
                err as Error,
              );
            }
          } else {
            consecutiveOverloaded = 0;
          }

          if (handleSchemaRetry(currentRequest, err)) {
            schemaAttempt++;
            currentRequest = buildStricterRequest(currentRequest, err as JsonValidationError);
            attempt--;
            await sleep(500);
            continue;
          }

          const category = classifyProviderError(err);
          if (
            category === "context_overflow" &&
            maxTokensRecoveryAttempt < MAX_TOKENS_RECOVERY_ATTEMPTS
          ) {
            maxTokensRecoveryAttempt++;
            const reduced = reduceMaxTokens(currentRequest, err);
            if (reduced) {
              currentRequest = reduced;
              attempt--;
              continue;
            }
          }

          if (attempt < maxRetries && isRetryableError(err)) {
            const delay = computeDelay(err, attempt, initialDelayMs, maxDelayMs);
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
          let consecutiveOverloaded = 0;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const response = await provider.generateStream!(request, onChunk);
              consecutiveOverloaded = 0;
              return response;
            } catch (err) {
              lastError = err;

              if (isOverloadedError(err)) {
                consecutiveOverloaded++;
                if (consecutiveOverloaded >= MAX_OVERLOADED_CONSECUTIVE) {
                  throw new OverloadedExhaustedError(
                    `Provider overloaded after ${MAX_OVERLOADED_CONSECUTIVE} consecutive attempts`,
                    err as Error,
                  );
                }
              } else {
                consecutiveOverloaded = 0;
              }

              if (attempt < maxRetries && isRetryableError(err)) {
                const delay = computeDelay(err, attempt, initialDelayMs, maxDelayMs);
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
          let consecutiveOverloaded = 0;
          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const response = await provider.generateWithTools!(request);
              consecutiveOverloaded = 0;
              return response;
            } catch (err) {
              lastError = err;

              if (isOverloadedError(err)) {
                consecutiveOverloaded++;
                if (consecutiveOverloaded >= MAX_OVERLOADED_CONSECUTIVE) {
                  throw new OverloadedExhaustedError(
                    `Provider overloaded after ${MAX_OVERLOADED_CONSECUTIVE} consecutive attempts`,
                    err as Error,
                  );
                }
              } else {
                consecutiveOverloaded = 0;
              }

              if (attempt < maxRetries && isRetryableError(err)) {
                const delay = computeDelay(err, attempt, initialDelayMs, maxDelayMs);
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
