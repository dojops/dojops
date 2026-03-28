import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: mockCreate,
      stream: vi.fn(),
    };
    models = {
      list: vi.fn().mockResolvedValue({ data: [] }),
    };
  },
}));

import { AnthropicProvider } from "../../llm/anthropic";

describe("AnthropicProvider empty content guard", () => {
  let provider: AnthropicProvider;
  const schema = z.object({ name: z.string() });

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider("fake-key", "claude-sonnet-4-5-20250929");
  });

  it("throws when schema request returns empty content after prefill", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    await expect(provider.generate({ prompt: "test", schema })).rejects.toThrow(
      "Anthropic returned empty content with prefill; cannot construct valid JSON",
    );
  });

  it("throws when schema request returns whitespace-only content after prefill", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "   " }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 1 },
    });

    await expect(provider.generate({ prompt: "test", schema })).rejects.toThrow(
      "Anthropic returned empty content with prefill; cannot construct valid JSON",
    );
  });
});
