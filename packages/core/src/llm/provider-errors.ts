/**
 * Normalized provider error categories.
 * Consumers can switch on `category` instead of parsing provider-specific error messages.
 */
export type ProviderErrorCategory =
  | "context_overflow" // prompt too long for the model's context window
  | "max_tokens" // response truncated by max_tokens limit
  | "rate_limit" // 429 / rate limit / overloaded
  | "auth" // 401 / 403 / invalid API key
  | "server" // 5xx / internal error
  | "network" // ECONNRESET, socket hang up, DNS
  | "validation" // schema validation / JSON parse failure
  | "unknown";

/**
 * Normalized provider error with a machine-readable category.
 * Wraps the original error from the provider SDK.
 */
export class DojOpsProviderError extends Error {
  constructor(
    message: string,
    public readonly category: ProviderErrorCategory,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DojOpsProviderError";
  }
}

/**
 * Detect the error category from a raw provider error.
 * This is a heuristic classifier that checks error messages and HTTP status codes
 * across all supported providers (OpenAI, Anthropic, Ollama, etc.).
 */
export function classifyProviderError(err: unknown): ProviderErrorCategory {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Context overflow (prompt too long)
  if (
    lower.includes("context_length_exceeded") ||
    lower.includes("prompt is too long") ||
    lower.includes("maximum context length") ||
    lower.includes("too many tokens") ||
    lower.includes("input too long") ||
    lower.includes("request too large") ||
    /\b413\b/.test(lower) ||
    lower.includes("payload too large")
  ) {
    return "context_overflow";
  }

  // Max tokens (response truncated)
  if (
    lower.includes("max_tokens") ||
    (lower.includes("maximum") && lower.includes("tokens")) ||
    (lower.includes("response") && lower.includes("truncated"))
  ) {
    return "max_tokens";
  }

  // Rate limit
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("overloaded") ||
    lower.includes("too many requests")
  ) {
    return "rate_limit";
  }

  // Auth errors
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    (lower.includes("invalid") && lower.includes("api") && lower.includes("key")) ||
    lower.includes("authentication")
  ) {
    return "auth";
  }

  // Server errors
  if (
    lower.includes("internal server error") ||
    lower.includes("bad gateway") ||
    lower.includes("service unavailable") ||
    /\bstatus\s*(code\s*)?5\d\d\b/.test(lower)
  ) {
    return "server";
  }

  // Network errors
  if (
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up") ||
    lower.includes("etimedout") ||
    lower.includes("dns") ||
    lower.includes("network")
  ) {
    return "network";
  }

  return "unknown";
}

/**
 * Check if an error indicates context overflow (prompt too long).
 * Convenience wrapper for the common case.
 */
export function isContextOverflowError(err: unknown): boolean {
  return classifyProviderError(err) === "context_overflow";
}
