import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { OpenAIProvider } from "../../llm/openai";
import { AnthropicProvider } from "../../llm/anthropic";
import { OllamaProvider } from "../../llm/ollama";

const TestSchema = z.object({ answer: z.string() });

const { mockOpenAICreate, mockAnthropicCreate, mockAxiosPost, mockAxiosGet } = vi.hoisted(() => ({
  mockOpenAICreate: vi.fn(),
  mockAnthropicCreate: vi.fn(),
  mockAxiosPost: vi.fn(),
  mockAxiosGet: vi.fn(),
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
  default: {
    post: mockAxiosPost,
    get: mockAxiosGet,
    isAxiosError: (err: unknown) =>
      err instanceof Error && "isAxiosError" in (err as Record<string, unknown>),
  },
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

  // ---------------------------------------------------------------
  // Error path tests
  // ---------------------------------------------------------------

  it("throws clear error on HTTP 401 Unauthorized", async () => {
    mockOpenAICreate.mockRejectedValue(
      new Error(
        '401 {"error":{"message":"Incorrect API key provided: sk-proj-abc123...","type":"invalid_request_error","code":"invalid_api_key"}}',
      ),
    );

    const provider = new OpenAIProvider("bad-key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/Incorrect API key/);
  });

  it("throws appropriate error on HTTP 429 rate limiting", async () => {
    mockOpenAICreate.mockRejectedValue(
      new Error(
        '429 {"error":{"message":"Rate limit reached for gpt-4o-mini. Please retry after 20s.","type":"tokens","code":"rate_limit_exceeded"}}',
      ),
    );

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/Rate limit reached/);
  });

  it("throws appropriate error on HTTP 503 service unavailability", async () => {
    mockOpenAICreate.mockRejectedValue(
      new Error(
        '503 {"error":{"message":"The server is temporarily unable to handle the request.","type":"server_error"}}',
      ),
    );

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/temporarily unable/);
  });

  it("throws clear error on network ECONNREFUSED", async () => {
    const networkErr = new Error("connect ECONNREFUSED 127.0.0.1:443");
    mockOpenAICreate.mockRejectedValue(networkErr);

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("throws error on malformed LLM response (invalid JSON) with schema", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "This is not valid JSON {{{" } }],
    });

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi", schema: TestSchema })).rejects.toThrow(
      /Failed to parse JSON|Schema validation failed/,
    );
  });

  it("throws error when choices array is empty", async () => {
    mockOpenAICreate.mockResolvedValue({ choices: [] });

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/empty choices/);
  });

  it("throws error when structured response is truncated (finish_reason=length)", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer":"partial' }, finish_reason: "length" }],
    });

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi", schema: TestSchema })).rejects.toThrow(
      /truncated/i,
    );
  });

  it("redacts API keys in error messages", async () => {
    mockOpenAICreate.mockRejectedValue(
      new Error(
        '401 {"error":{"message":"Invalid API key: sk-proj-abcdefghijklmnopqrstuvwxyz123456"}}',
      ),
    );

    const provider = new OpenAIProvider("key");
    try {
      await provider.generate({ prompt: "Hi" });
      expect.fail("should have thrown");
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
      expect(msg).toContain("REDACTED");
    }
  });

  it("extracts nested error message from SDK JSON errors", async () => {
    mockOpenAICreate.mockRejectedValue(
      new Error(
        '400 {"error":{"message":"Invalid prompt: too long","type":"invalid_request_error"}}',
      ),
    );

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/Invalid prompt: too long/);
  });

  it("falls back to raw error message when JSON extraction fails", async () => {
    mockOpenAICreate.mockRejectedValue(new Error("Something went wrong without JSON"));

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(
      /Something went wrong without JSON/,
    );
  });

  it("handles non-Error thrown values", async () => {
    mockOpenAICreate.mockRejectedValue("plain string error");

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/plain string error/);
  });

  it("includes token usage in successful response", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "Hello!" } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("forwards messages array when provided", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "response" } }],
    });

    const provider = new OpenAIProvider("key");
    await provider.generate({
      prompt: "Hi",
      system: "Be helpful",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
    });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages).toHaveLength(4); // system + 3 messages
  });

  it("filters out system role from messages array", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "response" } }],
    });

    const provider = new OpenAIProvider("key");
    await provider.generate({
      prompt: "Hi",
      messages: [
        { role: "system", content: "extra system" },
        { role: "user", content: "hello" },
      ],
    });

    const call = mockOpenAICreate.mock.calls[0][0];
    const roles = call.messages.map((m: { role: string }) => m.role);
    expect(roles.filter((r: string) => r === "system")).toHaveLength(1);
  });

  it("returns undefined usage when not present", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });
    expect(res.usage).toBeUndefined();
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

  it("sends JSON Schema object (not string) when schema is provided", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { response: '{"answer":"x"}' },
    });

    const provider = new OllamaProvider("http://localhost:11434");
    await provider.generate({ prompt: "q", schema: TestSchema });

    const call = mockAxiosPost.mock.calls[0];
    expect(call[0]).toBe("http://localhost:11434/api/generate");
    // format should be a JSON Schema object, not the string "json"
    expect(call[1].format).toEqual(expect.objectContaining({ type: "object" }));
    expect(call[1].format).not.toBe("json");
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

  // ---------------------------------------------------------------
  // Token usage extraction
  // ---------------------------------------------------------------

  describe("token usage extraction", () => {
    it("extracts prompt_eval_count and eval_count from /api/generate", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { response: "Hello!", prompt_eval_count: 15, eval_count: 8 },
      });

      const provider = new OllamaProvider();
      const res = await provider.generate({ prompt: "Hi" });

      expect(res.usage).toEqual({ promptTokens: 15, completionTokens: 8, totalTokens: 23 });
    });

    it("extracts prompt_eval_count and eval_count from /api/chat", async () => {
      mockAxiosPost.mockResolvedValue({
        data: {
          message: { content: "Hello!" },
          prompt_eval_count: 20,
          eval_count: 12,
        },
      });

      const provider = new OllamaProvider();
      const res = await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(res.usage).toEqual({ promptTokens: 20, completionTokens: 12, totalTokens: 32 });
    });

    it("returns undefined usage when counts missing", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "Hello!" } });

      const provider = new OllamaProvider();
      const res = await provider.generate({ prompt: "Hi" });

      expect(res.usage).toBeUndefined();
    });

    it("returns undefined usage when only one count present", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { response: "Hello!", prompt_eval_count: 15 },
      });

      const provider = new OllamaProvider();
      const res = await provider.generate({ prompt: "Hi" });

      expect(res.usage).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // Request timeout
  // ---------------------------------------------------------------

  describe("request timeout", () => {
    it("passes timeout config to axios.post for generate", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider();
      await provider.generate({ prompt: "Hi" });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig).toEqual({ timeout: 120_000 });
    });

    it("passes timeout config to axios.post for chat", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { message: { content: "ok" } },
      });

      const provider = new OllamaProvider();
      await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig).toEqual({ timeout: 120_000 });
    });

    it("passes timeout config to axios.get for listModels", async () => {
      mockAxiosGet.mockResolvedValue({ data: { models: [] } });

      const provider = new OllamaProvider();
      await provider.listModels();

      const axiosConfig = mockAxiosGet.mock.calls[0][1];
      expect(axiosConfig).toEqual({ timeout: 120_000 });
    });

    it("throws timeout error with helpful message on ECONNABORTED", async () => {
      const err = new Error("timeout of 120000ms exceeded") as Error & {
        isAxiosError: boolean;
        code: string;
      };
      err.isAxiosError = true;
      err.code = "ECONNABORTED";
      mockAxiosPost.mockRejectedValue(err);

      const provider = new OllamaProvider();
      await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/timed out after 120s/);
    });
  });

  // ---------------------------------------------------------------
  // JSON Schema format
  // ---------------------------------------------------------------

  describe("JSON Schema format", () => {
    it("sends JSON Schema in chat mode too", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { message: { content: '{"answer":"x"}' } },
      });

      const provider = new OllamaProvider();
      await provider.generate({
        prompt: "q",
        schema: TestSchema,
        messages: [{ role: "user", content: "q" }],
      });

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].format).toEqual(expect.objectContaining({ type: "object" }));
      expect(call[1].format).not.toBe("json");
    });

    it("does not send format when no schema", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider();
      await provider.generate({ prompt: "Hi" });

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].format).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // Model-not-found (404)
  // ---------------------------------------------------------------

  describe("model-not-found", () => {
    it('throws helpful error with "ollama pull" hint on 404', async () => {
      const err = new Error("Request failed with status 404") as Error & {
        isAxiosError: boolean;
        response: { status: number };
      };
      err.isAxiosError = true;
      err.response = { status: 404 };
      mockAxiosPost.mockRejectedValue(err);

      const provider = new OllamaProvider(undefined, "mistral");
      await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(
        /Model "mistral" not found.*ollama pull mistral/,
      );
    });

    it("ECONNREFUSED still gets connection message", async () => {
      const err = new Error("connect ECONNREFUSED") as Error & {
        isAxiosError: boolean;
        code: string;
      };
      err.isAxiosError = true;
      err.code = "ECONNREFUSED";
      mockAxiosPost.mockRejectedValue(err);

      const provider = new OllamaProvider();
      await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/Cannot connect to Ollama/);
    });
  });

  // ---------------------------------------------------------------
  // keep_alive
  // ---------------------------------------------------------------

  describe("keep_alive", () => {
    it("sends keep_alive in generate request", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider();
      await provider.generate({ prompt: "Hi" });

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].keep_alive).toBe("5m");
    });

    it("sends keep_alive in chat request", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { message: { content: "ok" } },
      });

      const provider = new OllamaProvider();
      await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].keep_alive).toBe("5m");
    });

    it('uses default "5m" when not specified', () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider();
      // default constructor — keepAlive should be "5m"
      provider.generate({ prompt: "Hi" });

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].keep_alive).toBe("5m");
    });

    it("uses custom keep_alive when specified", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider(undefined, undefined, "30m");
      await provider.generate({ prompt: "Hi" });

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].keep_alive).toBe("30m");
    });
  });

  // ---------------------------------------------------------------
  // TLS configuration
  // ---------------------------------------------------------------

  describe("TLS configuration", () => {
    it("does not include httpsAgent by default", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider();
      await provider.generate({ prompt: "Hi" });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig.httpsAgent).toBeUndefined();
    });

    it("does not include httpsAgent when tlsRejectUnauthorized is true", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider("https://ollama.internal:8443", "llama3", "5m", true);
      await provider.generate({ prompt: "Hi" });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig.httpsAgent).toBeUndefined();
    });

    it("includes httpsAgent with rejectUnauthorized=false when TLS verification disabled", async () => {
      mockAxiosPost.mockResolvedValue({ data: { response: "ok" } });

      const provider = new OllamaProvider("https://ollama.internal:8443", "llama3", "5m", false);
      await provider.generate({ prompt: "Hi" });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig.httpsAgent).toBeDefined();
      expect(axiosConfig.httpsAgent.options.rejectUnauthorized).toBe(false);
    });

    it("passes httpsAgent to listModels when TLS verification disabled", async () => {
      mockAxiosGet.mockResolvedValue({ data: { models: [] } });

      const provider = new OllamaProvider("https://ollama.internal:8443", "llama3", "5m", false);
      await provider.listModels();

      const axiosConfig = mockAxiosGet.mock.calls[0][1];
      expect(axiosConfig.httpsAgent).toBeDefined();
      expect(axiosConfig.httpsAgent.options.rejectUnauthorized).toBe(false);
    });

    it("passes httpsAgent to chat requests when TLS verification disabled", async () => {
      mockAxiosPost.mockResolvedValue({
        data: { message: { content: "ok" } },
      });

      const provider = new OllamaProvider("https://ollama.internal:8443", "llama3", "5m", false);
      await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig.httpsAgent).toBeDefined();
    });
  });
});
