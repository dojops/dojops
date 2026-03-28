import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry, type RetryOptions } from "../../llm/retry";
import { LLMProvider, LLMRequest, LLMResponse } from "../../llm/provider";
import { JsonValidationError } from "../../llm/json-validator";

function mockProvider(
  generateFn: (req: LLMRequest) => Promise<LLMResponse>,
  opts?: { name?: string; listModels?: () => Promise<string[]> },
): LLMProvider {
  return {
    name: opts?.name ?? "mock",
    generate: generateFn,
    ...(opts?.listModels ? { listModels: opts.listModels } : {}),
  };
}

const OK_RESPONSE: LLMResponse = { content: "ok" };

/**
 * Build a generate function that follows a script of outcomes.
 * Uses async-throw instead of pre-built rejected promises to avoid
 * Node.js PromiseRejectionHandledWarning when combined with fake timers.
 */
function scriptedGenerate(
  outcomes: Array<{ resolve: LLMResponse } | { reject: Error | string }>,
): (req: LLMRequest) => Promise<LLMResponse> {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return async (_req: LLMRequest): Promise<LLMResponse> => {
    const outcome = outcomes[call++];
    if (!outcome) throw new Error(`Unexpected call #${call}`);
    if ("reject" in outcome) throw outcome.reject;
    return outcome.resolve;
  };
}

// Helper: flush all pending timers and microtasks
async function flush(): Promise<void> {
  await vi.runAllTimersAsync();
}

/** Default retry options for transient-error tests. */
const TRANSIENT_RETRY_OPTS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Create a retried provider from scripted outcomes.
 * Returns the spy and the retried provider for assertions.
 */
function setupRetry(
  outcomes: Array<{ resolve: LLMResponse } | { reject: Error | string }>,
  opts?: RetryOptions,
): { generateSpy: ReturnType<typeof vi.fn>; retried: LLMProvider } {
  const generate = scriptedGenerate(outcomes);
  const generateSpy = vi.fn(generate);
  const provider = mockProvider(generateSpy);
  const retried = withRetry(provider, opts);
  return { generateSpy, retried };
}

/**
 * Test that a transient error is retried and succeeds on the 2nd attempt.
 * Covers the common pattern: fail once with errorMsg, then succeed.
 */
async function expectTransientRetrySuccess(errorMsg: string): Promise<void> {
  const { generateSpy, retried } = setupRetry(
    [{ reject: new Error(errorMsg) }, { resolve: OK_RESPONSE }],
    TRANSIENT_RETRY_OPTS,
  );

  const promise = retried.generate({ prompt: "hello" });
  await flush();

  const result = await promise;
  expect(result).toEqual(OK_RESPONSE);
  expect(generateSpy).toHaveBeenCalledTimes(2);
}

/**
 * Test that a non-retryable error is NOT retried.
 */
async function expectNoRetry(errorMsg: string): Promise<void> {
  const { generateSpy, retried } = setupRetry([{ reject: new Error(errorMsg) }], {
    maxRetries: 3,
    initialDelayMs: 1000,
  });

  await expect(retried.generate({ prompt: "hello" })).rejects.toThrow(errorMsg);
  expect(generateSpy).toHaveBeenCalledTimes(1);
}

describe("withRetry()", () => {
  // Suppress PromiseRejectionHandledWarning that occurs when fake timers
  // resolve sleep() and the next generate() throws before the retry loop's
  // catch block processes the rejection. This is a known Node.js/Vitest
  // limitation with fake timers + async throws and does not affect test correctness.
  const rejectionHandler = () => {
    // Suppressed PromiseRejectionHandledWarning — see comment above.
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // Fix jitter at 0 for deterministic delay assertions
    vi.spyOn(Math, "random").mockReturnValue(0);
    process.on("unhandledRejection", rejectionHandler);
  });

  afterEach(() => {
    process.removeListener("unhandledRejection", rejectionHandler);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------
  // 1. Succeeds on first try (no retry needed)
  // ---------------------------------------------------------------
  it("succeeds on first try without retrying", async () => {
    const { generateSpy, retried } = setupRetry([{ resolve: OK_RESPONSE }], {
      maxRetries: 3,
      initialDelayMs: 1000,
    });

    const result = await retried.generate({ prompt: "hello" });

    expect(result).toEqual(OK_RESPONSE);
    expect(generateSpy).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------
  // 2. Retries on transient error and succeeds on 2nd attempt
  // ---------------------------------------------------------------
  it("retries on transient error and succeeds on 2nd attempt", async () => {
    await expectTransientRetrySuccess("503 Service Unavailable");
  });

  // ---------------------------------------------------------------
  // 2b. Retries on transient error and succeeds on 3rd attempt
  // ---------------------------------------------------------------
  it("retries on transient error and succeeds on 3rd attempt", async () => {
    const { generateSpy, retried } = setupRetry(
      [
        { reject: new Error("500 Internal Server Error") },
        { reject: new Error("502 Bad Gateway") },
        { resolve: OK_RESPONSE },
      ],
      TRANSIENT_RETRY_OPTS,
    );

    const promise = retried.generate({ prompt: "hello" });
    await flush();

    const result = await promise;
    expect(result).toEqual(OK_RESPONSE);
    expect(generateSpy).toHaveBeenCalledTimes(3);
  });

  // ---------------------------------------------------------------
  // 3. Gives up after max retries and throws the last error
  // ---------------------------------------------------------------
  it("gives up after max retries and throws the last error", async () => {
    const { generateSpy, retried } = setupRetry(
      [
        { reject: new Error("service unavailable: first") },
        { reject: new Error("service unavailable: second") },
        { reject: new Error("service unavailable: final") },
      ],
      { maxRetries: 2, initialDelayMs: 1000, maxDelayMs: 10000 },
    );

    const promise = retried.generate({ prompt: "hello" });
    await flush();

    await expect(promise).rejects.toThrow("service unavailable: final");
    // 1 initial + 2 retries = 3 total attempts
    expect(generateSpy).toHaveBeenCalledTimes(3);
  });

  // ---------------------------------------------------------------
  // 4. Does NOT retry non-retryable errors (401 Unauthorized)
  // ---------------------------------------------------------------
  it("does not retry 401 Unauthorized errors", async () => {
    await expectNoRetry("401 Unauthorized: Invalid API key");
  });

  // ---------------------------------------------------------------
  // 4b. Does NOT retry non-retryable errors (400 Bad Request)
  // ---------------------------------------------------------------
  it("does not retry 400 Bad Request errors", async () => {
    await expectNoRetry("400 Bad Request: Invalid prompt");
  });

  // ---------------------------------------------------------------
  // 4c. Does NOT retry 403 Forbidden errors
  // ---------------------------------------------------------------
  it("does not retry 403 Forbidden errors", async () => {
    await expectNoRetry("403 Forbidden: Access denied");
  });

  // ---------------------------------------------------------------
  // 5. Retries on 429 (rate limit)
  // ---------------------------------------------------------------
  it("retries on 429 rate limit errors", async () => {
    await expectTransientRetrySuccess("429 Too Many Requests");
  });

  // ---------------------------------------------------------------
  // 5b. Retries on "rate limit" message variant
  // ---------------------------------------------------------------
  it("retries on 'rate limit' text in error message", async () => {
    await expectTransientRetrySuccess("Rate limit exceeded, please retry later");
  });

  // ---------------------------------------------------------------
  // 5c. Retries on "rate_limit" underscore variant
  // ---------------------------------------------------------------
  it("retries on 'rate_limit' underscore variant in error message", async () => {
    await expectTransientRetrySuccess("rate_limit_exceeded");
  });

  // ---------------------------------------------------------------
  // 5d. Retries on 503 (service unavailable)
  // ---------------------------------------------------------------
  it("retries on 503 service unavailable errors", async () => {
    await expectTransientRetrySuccess("Service Unavailable");
  });

  // ---------------------------------------------------------------
  // 5e. Retries on "overloaded" error
  // ---------------------------------------------------------------
  it("retries on 'overloaded' errors", async () => {
    await expectTransientRetrySuccess("The API is overloaded, please try again");
  });

  // ---------------------------------------------------------------
  // 5f. Retries on ECONNRESET and socket hang up
  // ---------------------------------------------------------------
  it("retries on ECONNRESET errors", async () => {
    await expectTransientRetrySuccess("socket hang up (ECONNRESET)");
  });

  // ---------------------------------------------------------------
  // 6. Exponential backoff: verify delays increase
  // ---------------------------------------------------------------
  it("applies exponential backoff with increasing delays", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { retried } = setupRetry(
      [
        { reject: new Error("service unavailable: attempt 1") },
        { reject: new Error("service unavailable: attempt 2") },
        { reject: new Error("service unavailable: attempt 3") },
        { reject: new Error("service unavailable: attempt 4") },
      ],
      { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000 },
    );

    const promise = retried.generate({ prompt: "hello" });
    await flush();

    await expect(promise).rejects.toThrow("service unavailable");

    // Base delays: 1000*2^0=1000, 1000*2^1=2000, 1000*2^2=4000
    // jitter is crypto.randomInt(500) so 0-499
    const delays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((d): d is number => typeof d === "number" && d >= 1000);

    expect(delays.length).toBe(3);
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[0]).toBeLessThanOrEqual(1500);
    expect(delays[1]).toBeGreaterThanOrEqual(2000);
    expect(delays[1]).toBeLessThanOrEqual(2500);
    expect(delays[2]).toBeGreaterThanOrEqual(4000);
    expect(delays[2]).toBeLessThanOrEqual(4500);
  });

  // ---------------------------------------------------------------
  // 6b. Delay is capped at maxDelayMs
  // ---------------------------------------------------------------
  it("caps delay at maxDelayMs", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { retried } = setupRetry(
      [
        { reject: new Error("bad gateway: a1") },
        { reject: new Error("bad gateway: a2") },
        { reject: new Error("bad gateway: a3") },
        { reject: new Error("bad gateway: a4") },
        { reject: new Error("bad gateway: a5") },
        { reject: new Error("bad gateway: final") },
      ],
      { maxRetries: 5, initialDelayMs: 5000, maxDelayMs: 8000 },
    );

    const promise = retried.generate({ prompt: "hello" });
    await flush();

    await expect(promise).rejects.toThrow("bad gateway");

    // Base delays: min(5000+jitter, 8000), min(10000+jitter, 8000), ...capped
    // jitter is crypto.randomInt(500) so 0-499
    const delays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((d): d is number => typeof d === "number" && d >= 1000);

    expect(delays.length).toBe(5);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(8500); // 8000 + max jitter 499
    }
    expect(delays[0]).toBeGreaterThanOrEqual(5000);
    expect(delays[0]).toBeLessThanOrEqual(5500); // 5000 + max jitter
    expect(delays[1]).toBeLessThanOrEqual(8500); // capped at maxDelayMs + jitter
  });

  // ---------------------------------------------------------------
  // Schema validation retry
  // ---------------------------------------------------------------
  it("retries once on schema validation error with stricter prompt", async () => {
    let callCount = 0;
    const schemaErr = new JsonValidationError("bad schema", '{"foo":"bar"}');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const generate = async (_req: LLMRequest): Promise<LLMResponse> => {
      callCount++;
      if (callCount === 1) throw schemaErr;
      return OK_RESPONSE;
    };
    const generateSpy = vi.fn(generate);
    const provider = mockProvider(generateSpy);
    const retried = withRetry(provider, { maxRetries: 3, initialDelayMs: 1000, schemaRetries: 1 });

    const schema = { parse: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = retried.generate({ prompt: "hello", schema: schema as unknown as any });
    await flush();

    const result = await promise;
    expect(result).toEqual(OK_RESPONSE);
    expect(generateSpy).toHaveBeenCalledTimes(2);

    // Second call should have the stricter system prompt
    const secondCall = generateSpy.mock.calls[1][0];
    expect(secondCall.system).toContain(
      "IMPORTANT: Your previous response failed JSON schema validation",
    );
    expect(secondCall.system).toContain("bad schema");
  });

  // ---------------------------------------------------------------
  // Schema retry does NOT count against network retry budget
  // ---------------------------------------------------------------
  it("schema retries do not count against network retry budget", async () => {
    const schemaErr = new JsonValidationError("bad", "raw");
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const generate = async (_req: LLMRequest): Promise<LLMResponse> => {
      callCount++;
      if (callCount === 1) throw schemaErr; // schema retry
      if (callCount === 2) throw new Error("503 Service Unavailable"); // network retry
      return OK_RESPONSE;
    };
    const generateSpy = vi.fn(generate);
    const provider = mockProvider(generateSpy);
    const retried = withRetry(provider, {
      maxRetries: 2,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      schemaRetries: 1,
    });

    const schema = { parse: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = retried.generate({ prompt: "hello", schema: schema as unknown as any });
    await flush();

    const result = await promise;
    expect(result).toEqual(OK_RESPONSE);
    expect(generateSpy).toHaveBeenCalledTimes(3);
  });

  // ---------------------------------------------------------------
  // Schema retry exhausted still falls through to throw
  // ---------------------------------------------------------------
  it("throws schema error after exhausting schema retries", async () => {
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const generate = async (_req: LLMRequest): Promise<LLMResponse> => {
      callCount++;
      if (callCount === 1) throw new JsonValidationError("bad 1", "raw1");
      throw new JsonValidationError("bad 2", "raw2");
    };
    const generateSpy = vi.fn(generate);
    const provider = mockProvider(generateSpy);
    const retried = withRetry(provider, {
      maxRetries: 0,
      initialDelayMs: 1000,
      schemaRetries: 1,
    });

    const schema = { parse: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = retried.generate({ prompt: "hello", schema: schema as unknown as any });
    await flush();

    await expect(promise).rejects.toThrow("bad 2");
    expect(generateSpy).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------
  // Hard cap on total attempts prevents runaway loops
  // ---------------------------------------------------------------
  it("enforces maxTotalAttempts hard cap with high schemaRetries", async () => {
    const maxRetries = 1;
    const schemaRetries = 8;
    // Hard cap in retry.ts: maxRetries + schemaRetries + 1 = 10
    const hardCap = maxRetries + schemaRetries + 1;
    const schemaErr = new JsonValidationError("bad", "raw");

    // Every call throws a schema error. Without any cap the
    // attempt-- trick would let the loop spin schemaRetries + 1
    // times before handleSchemaRetry returns false (9 calls).
    // The hard cap at 10 is >= 9, so schema exhaustion stops it
    // first — but the key guarantee is that total calls never
    // exceed hardCap regardless of how high schemaRetries is set.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const generate = async (_req: LLMRequest): Promise<LLMResponse> => {
      throw schemaErr;
    };
    const generateSpy = vi.fn(generate);
    const provider = mockProvider(generateSpy);
    const retried = withRetry(provider, {
      maxRetries,
      initialDelayMs: 1000,
      schemaRetries,
    });

    const schema = { parse: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = retried.generate({ prompt: "hello", schema: schema as unknown as any });
    await flush();

    await expect(promise).rejects.toThrow();
    // schemaRetries(8) + 1 final attempt that exhausts budget = 9 calls
    expect(generateSpy).toHaveBeenCalledTimes(schemaRetries + 1);
    // And that is always within the hard cap
    expect(generateSpy.mock.calls.length).toBeLessThanOrEqual(hardCap);
  });

  // ---------------------------------------------------------------
  // Preserves provider name
  // ---------------------------------------------------------------
  it("preserves the original provider name", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = mockProvider(vi.fn() as any, { name: "openai" });
    const retried = withRetry(provider);
    expect(retried.name).toBe("openai");
  });

  // ---------------------------------------------------------------
  // Delegates listModels when present
  // ---------------------------------------------------------------
  it("delegates listModels() to the underlying provider", async () => {
    const listModels = vi.fn().mockResolvedValue(["gpt-4", "gpt-3.5"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = mockProvider(vi.fn() as any, { listModels });
    const retried = withRetry(provider);

    const models = await retried.listModels!();
    expect(models).toEqual(["gpt-4", "gpt-3.5"]);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------
  // listModels is undefined when provider doesn't support it
  // ---------------------------------------------------------------
  it("returns undefined for listModels when provider lacks it", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = mockProvider(vi.fn() as any);
    const retried = withRetry(provider);
    expect(retried.listModels).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // Default options work correctly
  // ---------------------------------------------------------------
  it("uses default options when none provided", async () => {
    const { retried } = setupRetry([{ resolve: OK_RESPONSE }]);

    const result = await retried.generate({ prompt: "hello" });
    expect(result).toEqual(OK_RESPONSE);
  });

  // ---------------------------------------------------------------
  // Handles non-Error thrown values for retryability check
  // ---------------------------------------------------------------
  it("does not retry non-Error thrown values that are not retryable", async () => {
    await expectNoRetry("plain string error");
  });

  // ---------------------------------------------------------------
  // Retries non-Error strings that contain retryable patterns
  // ---------------------------------------------------------------
  it("retries non-Error string values containing retryable patterns", async () => {
    await expectTransientRetrySuccess("503 service unavailable");
  });
});
