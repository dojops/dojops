import { describe, it, expect } from "vitest";
import { redactSecrets } from "../../llm/redact";

describe("redactSecrets", () => {
  it.each([
    [
      "OpenAI sk-",
      "Error: Invalid API key sk-abcdefghijklmnopqrstuvwxyz1234",
      "sk-***REDACTED***",
      "abcdefghijklmnopqrstuvwxyz",
    ],
    [
      "OpenAI sk-proj-",
      "Key is sk-proj-AbCdEfGhIjKlMnOpQrStUvWx_12345678",
      "***REDACTED***",
      "AbCdEfGhIjKlMn",
    ],
    [
      "Gemini AIza",
      "API error with key AIzaSyA1234567890abcdefghijklmnopqrstuv",
      "AIza***REDACTED***",
      "SyA1234567890",
    ],
    [
      "Bearer token",
      "Token: Bearer sk-test-token-12345.abcdef was rejected",
      "Bearer ***REDACTED***",
      "sk-test-token",
    ],
    [
      "Authorization header",
      "Header Authorization: my-secret-value",
      "Authorization: ***REDACTED***",
      "my-secret-value",
    ],
    [
      "x-api-key header",
      "x-api-key: super-secret-key-12345",
      "x-api-key: ***REDACTED***",
      "super-secret-key",
    ],
    [
      "key mid-sentence",
      "Failed to authenticate with sk-AAAABBBBCCCCDDDDEEEEFFFFGGGG to OpenAI",
      "sk-***REDACTED***",
      "AAAABBBB",
    ],
    [
      "claude- prefix",
      "Model claude-sonnet-4-5-20250929-abcdef not found",
      "claude-***REDACTED***",
      "sonnet-4-5",
    ],
    [
      "Anthropic sk-ant-",
      "Error: Invalid key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
      "sk-ant-***REDACTED***",
      "AbCdEfGhIjKlMn",
    ],
    [
      "DeepSeek ds-",
      "Failed auth with key ds-AbCdEfGhIjKlMnOpQrStUvWxYz",
      "ds-***REDACTED***",
      "AbCdEfGhIjKlMn",
    ],
  ])("redacts %s keys", (_label, input, shouldContain, shouldNotContain) => {
    const result = redactSecrets(input);
    expect(result).toContain(shouldContain);
    expect(result).not.toContain(shouldNotContain);
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
});
