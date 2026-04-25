import { describe, it, expect } from "vitest";
import { extractApiError } from "../../llm/openai-compat";
import {
  classifyProviderError,
  DojOpsProviderError,
  isContextOverflowError,
} from "../../llm/provider-errors";

// ── extractApiError — error body parsing ───────────────────────────

describe("extractApiError — JSON error body extraction", () => {
  it("extracts message from flat JSON body in error message", () => {
    const err = new Error('400 {"message":"Invalid model: gpt-5"}');
    expect(extractApiError(err)).toBe("Invalid model: gpt-5");
  });

  it("falls back to full message for nested JSON (non-greedy regex)", () => {
    // The regex is non-greedy, so nested objects like {"error":{"message":"..."}}
    // match only the inner object, which may not have a message field at the top level
    const err = new Error('400 {"error":{"message":"Invalid model"}}');
    const result = extractApiError(err);
    expect(result).toContain("400");
  });

  it("extracts top-level message from JSON body", () => {
    const err = new Error('500 {"message":"Internal server error"}');
    expect(extractApiError(err)).toBe("Internal server error");
  });

  it("falls back to full message when JSON has no message field", () => {
    const err = new Error('400 {"code":"invalid_request"}');
    const result = extractApiError(err);
    expect(result).toContain("400");
    expect(result).toContain("invalid_request");
  });

  it("falls back to full message for non-JSON error", () => {
    const err = new Error("Connection timed out");
    expect(extractApiError(err)).toBe("Connection timed out");
  });

  it("falls back for malformed JSON in error message", () => {
    const err = new Error("400 {broken json}");
    // {broken json} is not valid JSON, but the regex matches {broken json}
    // JSON.parse fails, falls through to returning the full message
    const result = extractApiError(err);
    expect(result).toContain("400");
  });

  it("handles empty error message", () => {
    const err = new Error("");
    expect(extractApiError(err)).toBe("");
  });

  it("handles non-Error value (string)", () => {
    expect(extractApiError("raw string error")).toBe("raw string error");
  });

  it("handles non-Error value (number)", () => {
    expect(extractApiError(42)).toBe("42");
  });

  it("handles non-Error value (null)", () => {
    expect(extractApiError(null)).toBe("null");
  });

  it("handles non-Error value (undefined)", () => {
    expect(extractApiError(undefined)).toBe("undefined");
  });

  it("redacts API keys in extracted error messages", () => {
    const err = new Error(
      '401 {"error":{"message":"Invalid API key: sk-proj-abc123def456ghi789jkl012mno"}}',
    );
    const result = extractApiError(err);
    expect(result).toContain("REDACTED");
    expect(result).not.toContain("abc123def456ghi789jkl012mno");
  });

  it("redacts API keys in non-JSON error messages", () => {
    const err = new Error("Auth failed with key sk-abcdefghijklmnopqrstuvwxyz");
    const result = extractApiError(err);
    expect(result).toContain("REDACTED");
  });

  it("extracts from flat error object with error.message", () => {
    // When the JSON is flat enough for the non-greedy regex to capture a valid object
    const err = new Error('400 {"message":"Rate limit exceeded"}');
    expect(extractApiError(err)).toBe("Rate limit exceeded");
  });
});

// ── classifyProviderError — comprehensive category mapping ─────────

describe("classifyProviderError — comprehensive categories", () => {
  describe("context_overflow variants", () => {
    it.each([
      "context_length_exceeded",
      "This prompt is too long for the model",
      "maximum context length is 128000 tokens",
      "too many tokens in the input",
      "input too long for this model",
      "request too large for model",
      "413 Payload Too Large",
      "payload too large",
    ])("classifies '%s' as context_overflow", (msg) => {
      expect(classifyProviderError(new Error(msg))).toBe("context_overflow");
    });
  });

  describe("max_tokens variants", () => {
    it.each([
      "max_tokens must be greater than 0",
      "maximum number of tokens exceeded",
      "response was truncated due to token limit",
    ])("classifies '%s' as max_tokens", (msg) => {
      expect(classifyProviderError(new Error(msg))).toBe("max_tokens");
    });
  });

  describe("rate_limit variants", () => {
    it.each([
      "429 Too Many Requests",
      "rate limit exceeded",
      "rate_limit_exceeded: please slow down",
      "Server overloaded, please retry",
      "too many requests, please wait",
    ])("classifies '%s' as rate_limit", (msg) => {
      expect(classifyProviderError(new Error(msg))).toBe("rate_limit");
    });
  });

  describe("auth variants", () => {
    it.each([
      "401 Unauthorized",
      "403 Forbidden",
      "unauthorized access",
      "forbidden resource",
      "Invalid API key provided",
      "authentication required",
    ])("classifies '%s' as auth", (msg) => {
      expect(classifyProviderError(new Error(msg))).toBe("auth");
    });
  });

  describe("server variants", () => {
    it.each([
      "500 Internal Server Error",
      "502 Bad Gateway",
      "503 Service Unavailable",
      "status code 500",
      "status 503",
    ])("classifies '%s' as server", (msg) => {
      expect(classifyProviderError(new Error(msg))).toBe("server");
    });
  });

  describe("network variants", () => {
    it.each([
      "ECONNRESET",
      "ECONNREFUSED 127.0.0.1:11434",
      "socket hang up",
      "ETIMEDOUT",
      "DNS resolution failed",
      "network error occurred",
    ])("classifies '%s' as network", (msg) => {
      expect(classifyProviderError(new Error(msg))).toBe("network");
    });
  });

  describe("unknown fallback", () => {
    it.each(["Something unexpected happened", "Model not found", ""])(
      "classifies '%s' as unknown",
      (msg) => {
        expect(classifyProviderError(new Error(msg))).toBe("unknown");
      },
    );
  });

  describe("non-Error inputs", () => {
    it("classifies string values", () => {
      expect(classifyProviderError("429 rate limit")).toBe("rate_limit");
    });

    it("classifies object with toString", () => {
      expect(classifyProviderError({ toString: () => "401 auth error" })).toBe("auth");
    });

    it("classifies number as unknown", () => {
      expect(classifyProviderError(42)).toBe("unknown");
    });

    it("classifies null as unknown", () => {
      expect(classifyProviderError(null)).toBe("unknown");
    });
  });
});

// ── DojOpsProviderError — normalized wrapper ───────────────────────

describe("DojOpsProviderError — construction and properties", () => {
  it("has all required fields", () => {
    const cause = new Error("original");
    const err = new DojOpsProviderError("wrapped", "rate_limit", "openai", cause);

    expect(err.message).toBe("wrapped");
    expect(err.category).toBe("rate_limit");
    expect(err.provider).toBe("openai");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("DojOpsProviderError");
  });

  it("extends Error", () => {
    const err = new DojOpsProviderError("test", "unknown", "test");
    expect(err).toBeInstanceOf(Error);
  });

  it("works without cause", () => {
    const err = new DojOpsProviderError("no cause", "server", "gemini");
    expect(err.cause).toBeUndefined();
  });

  it("each category is a valid string", () => {
    const categories = [
      "context_overflow",
      "max_tokens",
      "rate_limit",
      "auth",
      "server",
      "network",
      "validation",
      "unknown",
    ] as const;

    for (const cat of categories) {
      const err = new DojOpsProviderError(`${cat} error`, cat, "test");
      expect(err.category).toBe(cat);
    }
  });
});

// ── isContextOverflowError — convenience wrapper ───────────────────

describe("isContextOverflowError — convenience checks", () => {
  it("returns true for all context overflow patterns", () => {
    expect(isContextOverflowError(new Error("context_length_exceeded"))).toBe(true);
    expect(isContextOverflowError(new Error("prompt is too long"))).toBe(true);
    expect(isContextOverflowError(new Error("413 payload too large"))).toBe(true);
  });

  it("returns false for non-context errors", () => {
    expect(isContextOverflowError(new Error("429 rate limit"))).toBe(false);
    expect(isContextOverflowError(new Error("401 unauthorized"))).toBe(false);
    expect(isContextOverflowError(new Error("socket hang up"))).toBe(false);
    expect(isContextOverflowError(new Error("something else"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isContextOverflowError("just a string")).toBe(false);
    expect(isContextOverflowError(42)).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
  });
});

// ── Error classification priority ──────────────────────────────────

describe("Error classification — priority when multiple patterns match", () => {
  it("context_overflow wins over max_tokens for '413 payload too large max_tokens'", () => {
    expect(classifyProviderError(new Error("413 payload too large max_tokens"))).toBe(
      "context_overflow",
    );
  });

  it("context_overflow wins over rate_limit for '413 too many tokens'", () => {
    expect(classifyProviderError(new Error("413 too many tokens in request"))).toBe(
      "context_overflow",
    );
  });

  it("rate_limit wins over server for '429 internal server error'", () => {
    // 429 is checked before server patterns
    expect(classifyProviderError(new Error("429 internal server error"))).toBe("rate_limit");
  });

  it("case insensitive matching", () => {
    expect(classifyProviderError(new Error("RATE LIMIT EXCEEDED"))).toBe("rate_limit");
    expect(classifyProviderError(new Error("ECONNREFUSED"))).toBe("network");
    expect(classifyProviderError(new Error("UNAUTHORIZED"))).toBe("auth");
  });
});
