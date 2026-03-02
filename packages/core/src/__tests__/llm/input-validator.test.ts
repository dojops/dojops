import { describe, it, expect } from "vitest";
import { validateRequestSize } from "../../llm/input-validator";

describe("validateRequestSize", () => {
  it("returns valid for small requests", () => {
    const result = validateRequestSize({ prompt: "Hello world", system: "You are helpful" });
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("returns invalid when estimated tokens exceed max", () => {
    const longPrompt = "x".repeat(500_000); // ~125k tokens
    const result = validateRequestSize({ prompt: longPrompt });
    expect(result.valid).toBe(false);
    expect(result.warning).toContain("exceeds estimated token limit");
  });

  it("returns warning when approaching limit (>80%)", () => {
    // 100k max tokens = 400k chars. 80% = 320k chars
    const prompt = "x".repeat(340_000); // ~85k tokens
    const result = validateRequestSize({ prompt });
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("approaching token limit");
  });

  it("respects custom maxTokens", () => {
    const prompt = "x".repeat(1000); // ~250 tokens
    const result = validateRequestSize({ prompt }, 100);
    expect(result.valid).toBe(false);
    expect(result.warning).toContain("exceeds estimated token limit");
  });

  it("counts system prompt characters", () => {
    const result = validateRequestSize({ prompt: "x".repeat(100), system: "x".repeat(500_000) });
    expect(result.valid).toBe(false);
  });

  it("counts message characters", () => {
    const result = validateRequestSize({
      prompt: "hi",
      messages: [{ role: "user", content: "x".repeat(500_000) }],
    });
    expect(result.valid).toBe(false);
  });

  it("handles request with no system prompt", () => {
    const result = validateRequestSize({ prompt: "Hello" });
    expect(result.valid).toBe(true);
  });
});
