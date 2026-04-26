import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "../../llm/openai";
import { DeepSeekProvider } from "../../llm/deepseek";

const TestSchema = z.object({ answer: z.string() });

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
    models = { list: vi.fn() };
  },
}));

// ── OpenAI streaming tests ──────────────────────────────────────────

describe("OpenAIProvider.generateStream", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockStreamResponse(
    chunks: Array<{ content?: string; usage?: Record<string, unknown> }>,
  ) {
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) {
          yield {
            choices: [{ delta: { content: chunk.content } }],
            ...(chunk.usage ? { usage: chunk.usage } : {}),
          };
        }
      },
    };
  }

  it("accumulates streamed chunks into full response", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([{ content: "Hello" }, { content: " world" }, { content: "!" }]);
      }
      return { choices: [{ message: { content: "fallback" } }] };
    });

    const provider = new OpenAIProvider("key");
    const chunks: string[] = [];
    const res = await provider.generateStream({ prompt: "Hi" }, (c) => chunks.push(c));

    expect(chunks).toEqual(["Hello", " world", "!"]);
    expect(res.content).toBe("Hello world!");
  });

  it("extracts usage from final stream chunk", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([
          { content: "text" },
          { usage: { prompt_tokens: 25, completion_tokens: 10 } },
        ]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generateStream({ prompt: "Hi" }, () => {});

    expect(res.usage).toEqual({
      promptTokens: 25,
      completionTokens: 10,
      totalTokens: 35,
    });
  });

  it("extracts cached tokens from stream usage", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([
          { content: "ok" },
          {
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              prompt_tokens_details: { cached_tokens: 60 },
            },
          },
        ]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generateStream({ prompt: "Hi" }, () => {});

    expect(res.usage?.cacheReadTokens).toBe(60);
  });

  it("returns undefined usage when no usage in stream", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([{ content: "text" }]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generateStream({ prompt: "Hi" }, () => {});

    expect(res.usage).toBeUndefined();
  });

  it("falls back to non-streaming when schema is provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer":"42"}' } }],
    });

    const provider = new OpenAIProvider("key");
    const chunks: string[] = [];
    const res = await provider.generateStream({ prompt: "q", schema: TestSchema }, (c) =>
      chunks.push(c),
    );

    expect(chunks).toHaveLength(0);
    expect(res.parsed).toEqual({ answer: "42" });
    // Should not have called with stream: true
    const call = mockCreate.mock.calls[0][0];
    expect(call.stream).toBeUndefined();
  });

  it("sends stream: true to API", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([{ content: "ok" }]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    await provider.generateStream({ prompt: "Hi" }, () => {});

    const call = mockCreate.mock.calls[0][0];
    expect(call.stream).toBe(true);
  });

  it("passes temperature to streaming request", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([{ content: "ok" }]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    await provider.generateStream({ prompt: "Hi", temperature: 0.3 }, () => {});

    const call = mockCreate.mock.calls[0][0];
    expect(call.temperature).toBe(0.3);
  });

  it("handles multi-turn messages in streaming", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([{ content: "reply" }]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    await provider.generateStream(
      {
        prompt: "",
        system: "Be helpful",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
          { role: "user", content: "More" },
        ],
      },
      () => {},
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages).toHaveLength(4);
  });

  it("throws wrapped error when stream creation fails", async () => {
    mockCreate.mockRejectedValue(new Error('429 {"error":{"message":"Rate limit exceeded"}}'));

    const provider = new OpenAIProvider("key");
    await expect(provider.generateStream({ prompt: "Hi" }, () => {})).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  it("skips chunks with undefined content", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return mockStreamResponse([
          { content: "first" },
          { content: undefined },
          { content: "second" },
        ]);
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new OpenAIProvider("key");
    const chunks: string[] = [];
    const res = await provider.generateStream({ prompt: "Hi" }, (c) => chunks.push(c));

    expect(chunks).toEqual(["first", "second"]);
    expect(res.content).toBe("firstsecond");
  });
});

// ── DeepSeek streaming delegates to shared layer ────────────────────

describe("DeepSeekProvider.generateStream", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to openaiCompatGenerateStream", async () => {
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return {
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "DeepSeek " } }] };
            yield { choices: [{ delta: { content: "response" } }] };
          },
        };
      }
      return { choices: [{ message: { content: "x" } }] };
    });

    const provider = new DeepSeekProvider("key");
    const chunks: string[] = [];
    const res = await provider.generateStream({ prompt: "Hi" }, (c) => chunks.push(c));

    expect(chunks).toEqual(["DeepSeek ", "response"]);
    expect(res.content).toBe("DeepSeek response");
  });
});
