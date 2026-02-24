import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";

const TestSchema = z.object({ answer: z.string() });

const { mockOpenAICreate, mockAnthropicCreate, mockAxiosPost } = vi.hoisted(() => ({
  mockOpenAICreate: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockAxiosPost: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockOpenAICreate } };
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockAnthropicCreate };
  },
}));

vi.mock("axios", () => ({
  default: { post: mockAxiosPost },
}));

// ---- Tests ----

describe("OpenAIProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has name 'openai'", () => {
    expect(new OpenAIProvider("key").name).toBe("openai");
  });

  it("generates plain text response", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "Hello!" } }],
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    const json = JSON.stringify({ answer: "42" });
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: json } }],
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "question", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("appends JSON instruction to system prompt when schema is provided", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer":"x"}' } }],
    });

    const provider = new OpenAIProvider("key");
    await provider.generate({
      prompt: "q",
      system: "Be helpful.",
      schema: TestSchema,
    });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain("Be helpful.");
    expect(call.messages[0].content).toContain("valid JSON");
    expect(call.response_format).toEqual({ type: "json_object" });
  });

  it("handles null content gracefully", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("");
  });

  it("passes temperature when provided", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });

    const provider = new OpenAIProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0.7 });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.temperature).toBe(0.7);
  });

  it("omits temperature when not provided", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });

    const provider = new OpenAIProvider("key");
    await provider.generate({ prompt: "Hi" });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.temperature).toBeUndefined();
  });
});

describe("AnthropicProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has name 'anthropic'", () => {
    expect(new AnthropicProvider("key").name).toBe("anthropic");
  });

  it("generates plain text response", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Hello!" }],
    });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '"answer":"42"}' }],
    });

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "q", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("adds assistant prefill when schema is provided", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: '"answer":"x"}' }],
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "q", schema: TestSchema });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.messages).toContainEqual({ role: "assistant", content: "{" });
  });

  it("passes temperature when provided", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0 });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.temperature).toBe(0);
  });

  it("omits temperature when not provided", async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "Hi" });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.temperature).toBeUndefined();
  });
});

describe("OllamaProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has name 'ollama'", () => {
    expect(new OllamaProvider().name).toBe("ollama");
  });

  it("generates plain text response", async () => {
    mockAxiosPost.mockResolvedValue({ data: { response: "Hello!" } });

    const provider = new OllamaProvider();
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { response: '{"answer":"42"}' },
    });

    const provider = new OllamaProvider();
    const res = await provider.generate({ prompt: "q", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("sends JSON format flag when schema is provided", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { response: '{"answer":"x"}' },
    });

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.generate({ prompt: "q", schema: TestSchema });

    const call = mockAxiosPost.mock.calls[0];
    expect(call[0]).toBe("http://localhost:11434/api/generate");
    expect(call[1].format).toBe("json");
    expect(call[1].stream).toBe(false);
  });

  it("uses custom base URL", async () => {
    mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

    const provider = new OllamaProvider("http://custom:9999");
    await provider.generate({ prompt: "Hi" });

    expect(mockAxiosPost.mock.calls[0][0]).toBe("http://custom:9999/api/generate");
  });

  it("passes temperature via options when provided", async () => {
    mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

    const provider = new OllamaProvider();
    await provider.generate({ prompt: "Hi", temperature: 0.5 });

    const call = mockAxiosPost.mock.calls[0];
    expect(call[1].options).toEqual({ temperature: 0.5 });
  });

  it("omits options when temperature not provided", async () => {
    mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

    const provider = new OllamaProvider();
    await provider.generate({ prompt: "Hi" });

    const call = mockAxiosPost.mock.calls[0];
    expect(call[1].options).toBeUndefined();
  });
});
