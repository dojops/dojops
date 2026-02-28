import { describe, it, expect } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("redacts OpenAI sk- prefixed keys", () => {
    const msg = "Error: Invalid API key sk-abcdefghijklmnopqrstuvwxyz1234";
    const result = redactSecrets(msg);
    expect(result).toContain("sk-***REDACTED***");
    expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts OpenAI sk-proj- prefixed keys", () => {
    const msg = "Key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWx_12345678";
    const result = redactSecrets(msg);
    expect(result).toContain("***REDACTED***");
    expect(result).not.toContain("AbCdEfGhIjKlMn");
  });

  it("redacts Gemini AIza keys", () => {
    const msg = "API error with key AIzaSyA1234567890abcdefghijklmnopqrstuv";
    const result = redactSecrets(msg);
    expect(result).toContain("AIza***REDACTED***");
    expect(result).not.toContain("SyA1234567890");
  });

  it("redacts Bearer tokens", () => {
    const msg = "Token: Bearer sk-test-token-12345.abcdef was rejected";
    const result = redactSecrets(msg);
    expect(result).toContain("Bearer ***REDACTED***");
    expect(result).not.toContain("sk-test-token");
  });

  it("redacts Authorization header values", () => {
    const msg = "Header Authorization: my-secret-value";
    const result = redactSecrets(msg);
    expect(result).toContain("Authorization: ***REDACTED***");
    expect(result).not.toContain("my-secret-value");
  });

  it("redacts x-api-key header values", () => {
    const msg = "x-api-key: super-secret-key-12345";
    const result = redactSecrets(msg);
    expect(result).toContain("x-api-key: ***REDACTED***");
    expect(result).not.toContain("super-secret-key");
  });

  it("redacts key embedded mid-sentence", () => {
    const msg = "Failed to authenticate with sk-AAAABBBBCCCCDDDDEEEEFFFFGGGG to OpenAI";
    const result = redactSecrets(msg);
    expect(result).toContain("sk-***REDACTED***");
    expect(result).not.toContain("AAAABBBB");
  });

  it("returns plain messages unchanged", () => {
    const msg = "Connection refused: ECONNREFUSED 127.0.0.1:11434";
    expect(redactSecrets(msg)).toBe(msg);
  });

  it("handles empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("redacts multiple keys in same message", () => {
    const msg = "Tried sk-key1abcdefghijklmnopqrstu then AIzaSyBcdefghijklmnopqrstuvwxyz1234567";
    const result = redactSecrets(msg);
    expect(result).toContain("sk-***REDACTED***");
    expect(result).toContain("AIza***REDACTED***");
    expect(result).not.toContain("key1abcdef");
  });

  it("redacts claude- prefixed strings (model names in errors)", () => {
    const msg = "Model claude-sonnet-4-5-20250929-abcdef not found";
    const result = redactSecrets(msg);
    expect(result).toContain("claude-***REDACTED***");
  });
});
