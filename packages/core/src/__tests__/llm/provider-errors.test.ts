import { describe, it, expect } from "vitest";
import {
  classifyProviderError,
  isContextOverflowError,
  DojOpsProviderError,
} from "../../llm/provider-errors";

describe("classifyProviderError", () => {
  it("detects context_length_exceeded", () => {
    expect(classifyProviderError(new Error("context_length_exceeded"))).toBe("context_overflow");
  });

  it("detects prompt is too long", () => {
    expect(classifyProviderError(new Error("This prompt is too long for the model"))).toBe(
      "context_overflow",
    );
  });

  it("detects maximum context length", () => {
    expect(classifyProviderError(new Error("maximum context length is 128000 tokens"))).toBe(
      "context_overflow",
    );
  });

  it("detects HTTP 413", () => {
    expect(classifyProviderError(new Error("413 Payload Too Large"))).toBe("context_overflow");
  });

  it("detects rate limits (429)", () => {
    expect(classifyProviderError(new Error("429 Too Many Requests"))).toBe("rate_limit");
  });

  it("detects rate_limit_exceeded", () => {
    expect(classifyProviderError(new Error("rate_limit_exceeded"))).toBe("rate_limit");
  });

  it("detects overloaded", () => {
    expect(classifyProviderError(new Error("overloaded"))).toBe("rate_limit");
  });

  it("detects auth errors (401)", () => {
    expect(classifyProviderError(new Error("401 Unauthorized"))).toBe("auth");
  });

  it("detects invalid API key", () => {
    expect(classifyProviderError(new Error("Invalid API key provided"))).toBe("auth");
  });

  it("detects server errors (500)", () => {
    expect(classifyProviderError(new Error("500 Internal Server Error"))).toBe("server");
  });

  it("detects 502 Bad Gateway", () => {
    expect(classifyProviderError(new Error("502 Bad Gateway"))).toBe("server");
  });

  it("detects network errors", () => {
    expect(classifyProviderError(new Error("ECONNRESET"))).toBe("network");
    expect(classifyProviderError(new Error("socket hang up"))).toBe("network");
    expect(classifyProviderError(new Error("ECONNREFUSED"))).toBe("network");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(classifyProviderError(new Error("Something weird happened"))).toBe("unknown");
  });

  it("handles non-Error values", () => {
    expect(classifyProviderError("string error 429")).toBe("rate_limit");
    expect(classifyProviderError(42)).toBe("unknown");
  });
});

describe("isContextOverflowError", () => {
  it("returns true for context overflow errors", () => {
    expect(isContextOverflowError(new Error("context_length_exceeded"))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isContextOverflowError(new Error("rate_limit"))).toBe(false);
  });
});

describe("DojOpsProviderError", () => {
  it("has correct properties", () => {
    const err = new DojOpsProviderError("test", "context_overflow", "openai", new Error("orig"));
    expect(err.message).toBe("test");
    expect(err.category).toBe("context_overflow");
    expect(err.provider).toBe("openai");
    expect(err.cause).toBeInstanceOf(Error);
    expect(err.name).toBe("DojOpsProviderError");
  });
});
