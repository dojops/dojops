import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../../llm/anthropic";

const TestSchema = z.object({ answer: z.string() });

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate, stream: vi.fn() };
    models = { list: vi.fn().mockResolvedValue({ data: [] }) };
  },
}));

// ── buildThinkingParam budget mapping ───────────────────────────────

describe("Anthropic thinking budget mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["low", 2048],
    ["medium", 8192],
    ["high", 32768],
  ] as const)("maps thinking level '%s' to budget_tokens %d", async (level, expectedBudget) => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }],
      thinking: level,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.thinking).toEqual({ type: "enabled", budget_tokens: expectedBudget });
  });

  it("sets max_tokens greater than budget_tokens", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }],
      thinking: "high",
      maxTokens: 4096,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.max_tokens).toBeGreaterThan(32768);
  });

  it("does not set thinking param for 'none'", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }],
      thinking: "none",
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.thinking).toBeUndefined();
  });

  it("does not set thinking param when undefined", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }],
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.thinking).toBeUndefined();
  });

  it("respects base maxTokens when it already exceeds budget + offset", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "t", description: "d", parameters: { type: "object", properties: {} } }],
      thinking: "low",
      maxTokens: 65536,
    });

    const call = mockCreate.mock.calls[0][0];
    // maxTokens = max(65536, 2048 + 4096) = 65536
    expect(call.max_tokens).toBe(65536);
  });
});

// ── Prefill fallback ────────────────────────────────────────────────

describe("Anthropic prefill fallback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds assistant prefill '{' for schema requests", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '"answer": "42"}' }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "question", schema: TestSchema });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages).toContainEqual({ role: "assistant", content: "{" });
  });

  it("prepends '{' to response content when prefill was used", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '"answer": "42"}' }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "q", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("retries without prefill when API rejects it", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("prefill is not supported for this model"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: '{"answer": "42"}' }],
        stop_reason: "end_turn",
      });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "q", schema: TestSchema });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    // Second call should not have the prefill message
    const secondCall = mockCreate.mock.calls[1][0];
    expect(secondCall.messages).not.toContainEqual({ role: "assistant", content: "{" });
    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("does not retry on non-prefill errors", async () => {
    mockCreate.mockRejectedValue(new Error("Invalid API key"));

    const provider = new AnthropicProvider("key");
    await expect(provider.generate({ prompt: "q", schema: TestSchema })).rejects.toThrow(
      "Invalid API key",
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("throws on retry failure", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("prefill error"))
      .mockRejectedValueOnce(new Error("Server overloaded"));

    const provider = new AnthropicProvider("key");
    await expect(provider.generate({ prompt: "q", schema: TestSchema })).rejects.toThrow(
      "Server overloaded",
    );
  });

  it("throws on truncated response with schema", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '"answer": "partial' }],
      stop_reason: "max_tokens",
    });

    const provider = new AnthropicProvider("key");
    await expect(provider.generate({ prompt: "q", schema: TestSchema })).rejects.toThrow(
      /truncated/i,
    );
  });

  it("throws on empty content with prefill", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await expect(provider.generate({ prompt: "q", schema: TestSchema })).rejects.toThrow(
      /empty content/i,
    );
  });

  it("does not add prefill for non-schema requests", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "Hi" });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages).not.toContainEqual({ role: "assistant", content: "{" });
  });
});

// ── Usage extraction with cache tokens ──────────────────────────────

describe("Anthropic usage extraction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("extracts cache_creation and cache_read tokens", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "response" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 80,
        cache_read_input_tokens: 20,
      },
    });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheCreationTokens: 80,
      cacheReadTokens: 20,
    });
  });

  it("returns undefined usage when not present", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.usage).toBeUndefined();
  });

  it("defaults cache tokens to 0 when not provided", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.usage?.cacheCreationTokens).toBe(0);
    expect(res.usage?.cacheReadTokens).toBe(0);
  });
});

// ── Multi-turn messages for generate ────────────────────────────────

describe("Anthropic multi-turn messages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters system messages from messages array", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "response" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({
      prompt: "",
      system: "System prompt",
      messages: [
        { role: "system", content: "extra system" },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "question" },
      ],
    });

    const call = mockCreate.mock.calls[0][0];
    // Only user and assistant messages, system goes to top-level
    const roles = call.messages.map((m: { role: string }) => m.role);
    expect(roles).not.toContain("system");
    expect(call.messages).toHaveLength(3);
  });

  it("passes system as top-level parameter", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "Hi", system: "Be concise" });

    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain("Be concise");
  });
});
