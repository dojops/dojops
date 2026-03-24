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

  it("redacts AWS access key IDs", () => {
    const msg = "Found credential AKIAIOSFODNN7EXAMPLE in config";
    const result = redactSecrets(msg);
    expect(result).toContain("AKIA***REDACTED***");
    expect(result).not.toContain("IOSFODNN7EXAMPLE");
  });

  it("redacts PEM private key headers", () => {
    const msg = "Leaked: -----BEGIN RSA PRIVATE KEY-----";
    expect(redactSecrets(msg)).toContain("***REDACTED_PRIVATE_KEY***");
  });

  it("redacts password assignments", () => {
    const msg = 'db_config: password="super_secret_123"';
    const result = redactSecrets(msg);
    expect(result).toContain("password=***REDACTED***");
    expect(result).not.toContain("super_secret_123");
  });

  it("redacts secret assignments", () => {
    const msg = "secret='my_client_secret_value'";
    const result = redactSecrets(msg);
    expect(result).toContain("secret=***REDACTED***");
    expect(result).not.toContain("my_client_secret_value");
  });

  it("redacts api_key assignments", () => {
    const msg = "api_key=abcdef123456789012";
    const result = redactSecrets(msg);
    expect(result).toContain("api_key=***REDACTED***");
    expect(result).not.toContain("abcdef123456789012");
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
