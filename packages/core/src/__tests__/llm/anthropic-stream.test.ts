import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStreamEvents = [
  { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
  { type: "message_stop" },
];

const mockFinalMessage = {
  usage: { input_tokens: 100, output_tokens: 50 },
};

const { mockCreate, mockStream } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockStream: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: mockCreate,
      stream: mockStream,
    };
    models = {
      list: vi.fn().mockResolvedValue({ data: [] }),
    };
  },
}));

import { AnthropicProvider } from "../../llm/anthropic";

describe("AnthropicProvider.generateStream", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider("test-key", "claude-sonnet-4-5-20250929");

    // Default mock for streaming
    mockStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const event of mockStreamEvents) {
          yield event;
        }
      },
      finalMessage: vi.fn().mockResolvedValue(mockFinalMessage),
    });

    // Default mock for non-streaming (schema fallback)
    // Anthropic prefill prepends "{" — mock returns the rest
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '"name":"test"}' }],
      usage: { input_tokens: 100, output_tokens: 50 },
      stop_reason: "end_turn",
    });
  });

  it("streams text chunks to callback", async () => {
    const chunks: string[] = [];
    const result = await provider.generateStream({ prompt: "Hello" }, (chunk) =>
      chunks.push(chunk),
    );

    expect(chunks).toEqual(["Hello ", "world"]);
    expect(result.content).toBe("Hello world");
    expect(mockStream).toHaveBeenCalledOnce();
  });

  it("returns usage from final message", async () => {
    const result = await provider.generateStream({ prompt: "Hello" }, () => {});

    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it("falls back to non-streaming for schema requests", async () => {
    const { z } = await import("zod");
    const schema = z.object({ name: z.string() });

    const chunks: string[] = [];
    await provider.generateStream({ prompt: "Hello", schema }, (chunk) => chunks.push(chunk));

    // Schema mode falls back to generate() — no streaming chunks
    expect(chunks).toHaveLength(0);
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockStream).not.toHaveBeenCalled();
  });
});
