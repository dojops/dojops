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
  const match = /(\d+)\s*\+\s*(\d+)\s*>\s*(\d+)/.exec(msg); // NOSONAR: disjoint literal tokens with no nested quantifiers; not vulnerable to ReDoS
  if (match) {
    const inputTokens = Number.parseInt(match[1], 10);
    const contextLimit = Number.parseInt(match[3], 10);
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
 * Track and enforce the overloaded-error consecutive limit.
 * Resets on non-overloaded errors. Throws OverloadedExhaustedError when the limit is hit.
 */
function handleOverloadedCheck(err: unknown, counter: { value: number }): void {
  if (isOverloadedError(err)) {
    counter.value++;
    if (counter.value >= MAX_OVERLOADED_CONSECUTIVE) {
      throw new OverloadedExhaustedError(
        `Provider overloaded after ${MAX_OVERLOADED_CONSECUTIVE} consecutive attempts`,
        err as Error,
      );
    }
  } else {
    counter.value = 0;
  }
}

/** Build a stricter request after a schema validation failure. */
function buildStricterRequest(req: LLMRequest, validationErr: JsonValidationError): LLMRequest {
  const stricterSystem =
    `${req.system ?? ""}\n\nIMPORTANT: Your previous response failed JSON schema validation: ${validationErr.message}. You MUST respond with valid JSON that matches the required schema exactly. No markdown fences, no extra text outside JSON.`.trim();
  return { ...req, system: stricterSystem };
}

/**
 * Generic retry loop for provider calls that don't need schema or context-overflow recovery.
 * Used by generateStream and generateWithTools.
 */
async function retryLoop<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  initialDelayMs: number,
  maxDelayMs: number,
): Promise<T> {
  let lastError: unknown;
  const overloaded = { value: 0 };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      overloaded.value = 0;
      return result;
    } catch (err) {
      lastError = err;
      handleOverloadedCheck(err, overloaded);

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

interface GenerateRetryState {
  currentRequest: LLMRequest;
  schemaAttempt: number;
  maxTokensRecoveryAttempt: number;
  overloaded: { value: number };
  lastError: unknown;
}

interface RetryLimits {
  attempt: number;
  maxRetries: number;
  schemaRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

type RetryAction = "retry" | "retry-no-attempt-increment" | "throw";

/** Try a schema-validation recovery; returns true if the request was rewritten. */
function trySchemaRecovery(
  err: unknown,
  state: GenerateRetryState,
  schemaRetries: number,
): boolean {
  const canRetry =
    !!state.currentRequest.schema &&
    isSchemaValidationError(err) &&
    state.schemaAttempt < schemaRetries;
  if (!canRetry) return false;
  state.schemaAttempt++;
  state.currentRequest = buildStricterRequest(state.currentRequest, err as JsonValidationError);
  return true;
}

/** Try a context-overflow recovery; returns true if maxTokens was reduced. */
function tryContextOverflowRecovery(err: unknown, state: GenerateRetryState): boolean {
  if (classifyProviderError(err) !== "context_overflow") return false;
  if (state.maxTokensRecoveryAttempt >= MAX_TOKENS_RECOVERY_ATTEMPTS) return false;
  const reduced = reduceMaxTokens(state.currentRequest, err);
  if (!reduced) return false;
  state.maxTokensRecoveryAttempt++;
  state.currentRequest = reduced;
  return true;
}

/** Decide what the catch block should do next. */
async function handleGenerateError(
  err: unknown,
  state: GenerateRetryState,
  limits: RetryLimits,
): Promise<RetryAction> {
  state.lastError = err;
  handleOverloadedCheck(err, state.overloaded);

  if (trySchemaRecovery(err, state, limits.schemaRetries)) {
    await sleep(500);
    return "retry-no-attempt-increment";
  }

  if (tryContextOverflowRecovery(err, state)) {
    return "retry-no-attempt-increment";
  }

  if (limits.attempt < limits.maxRetries && isRetryableError(err)) {
    const delay = computeDelay(err, limits.attempt, limits.initialDelayMs, limits.maxDelayMs);
    await sleep(delay);
    return "retry";
  }

  return "throw";
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
      const state: GenerateRetryState = {
        currentRequest: request,
        schemaAttempt: 0,
        maxTokensRecoveryAttempt: 0,
        overloaded: { value: 0 },
        lastError: undefined,
      };
      // Hard cap prevents infinite loops if schemaRetries is misconfigured
      const maxTotalAttempts = maxRetries + schemaRetries + MAX_TOKENS_RECOVERY_ATTEMPTS + 1;
      let totalAttempts = 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (++totalAttempts > maxTotalAttempts) break;

        try {
          const response = await provider.generate(state.currentRequest);
          state.overloaded.value = 0;
          return response;
        } catch (err) {
          const action = await handleGenerateError(err, state, {
            attempt,
            maxRetries,
            schemaRetries,
            initialDelayMs,
            maxDelayMs,
          });
          if (action === "retry-no-attempt-increment") {
            attempt--;
            continue;
          }
          if (action === "retry") continue;
          // action === "throw"
          throwRedactedError(err);
        }
      }
      throw state.lastError;
    },

    generateStream: provider.generateStream
      ? async (request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> => {
          return retryLoop(
            () => provider.generateStream!(request, onChunk),
            maxRetries,
            initialDelayMs,
            maxDelayMs,
          );
        }
      : undefined,

    generateWithTools: provider.generateWithTools
      ? async (request: LLMToolRequest): Promise<LLMToolResponse> => {
          return retryLoop(
            () => provider.generateWithTools!(request),
            maxRetries,
            initialDelayMs,
            maxDelayMs,
          );
        }
      : undefined,

    listModels: provider.listModels ? () => provider.listModels!() : undefined,
  };
}
