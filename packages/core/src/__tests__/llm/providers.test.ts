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

// ---- Mock response factories ----

/** Build an OpenAI-shaped mock response */
function openAIResponse(
  content: string | null,
  extra?: {
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    finish_reason?: string;
  },
) {
  return {
    choices: [
      { message: { content }, ...(extra?.finish_reason && { finish_reason: extra.finish_reason }) },
    ],
    ...(extra?.usage && { usage: extra.usage }),
  };
}

/** Build an Anthropic-shaped mock response */
function anthropicResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

/** Build an Ollama /api/generate-shaped mock response */
function ollamaGenerateResponse(
  response: string,
  extra?: { prompt_eval_count?: number; eval_count?: number },
) {
  return { data: { response, ...extra } };
}

/** Build an Ollama /api/chat-shaped mock response */
function ollamaChatResponse(
  content: string,
  extra?: { prompt_eval_count?: number; eval_count?: number },
) {
  return { data: { message: { content }, ...extra } };
}

/** Helper: set up Ollama generate mock, call generate, return the axios call args */
async function ollamaGenerateCall(
  provider: OllamaProvider,
  request: Parameters<OllamaProvider["generate"]>[0],
  mockResponse = ollamaGenerateResponse("ok"),
) {
  mockAxiosPost.mockResolvedValue(mockResponse);
  await provider.generate(request);
  return mockAxiosPost.mock.calls[0];
}

// ---- Tests ----

describe("OpenAIProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has name 'openai'", () => {
    expect(new OpenAIProvider("key").name).toBe("openai");
  });

  it("generates plain text response", async () => {
    mockOpenAICreate.mockResolvedValue(openAIResponse("Hello!"));

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    const json = JSON.stringify({ answer: "42" });
    mockOpenAICreate.mockResolvedValue(openAIResponse(json));

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "question", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("appends JSON instruction to system prompt when schema is provided", async () => {
    mockOpenAICreate.mockResolvedValue(openAIResponse('{"answer":"x"}'));

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
    mockOpenAICreate.mockResolvedValue(openAIResponse(null));

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("");
  });

  it("passes temperature when provided", async () => {
    mockOpenAICreate.mockResolvedValue(openAIResponse("ok"));

    const provider = new OpenAIProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0.7 });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.temperature).toBe(0.7);
  });

  it("omits temperature when not provided", async () => {
    mockOpenAICreate.mockResolvedValue(openAIResponse("ok"));

    const provider = new OpenAIProvider("key");
    await provider.generate({ prompt: "Hi" });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.temperature).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // Error path tests
  // ---------------------------------------------------------------

  it.each([
    [
      "HTTP 401 Unauthorized",
      '401 {"error":{"message":"Incorrect API key provided: sk-proj-abc123...","type":"invalid_request_error","code":"invalid_api_key"}}',
      /Incorrect API key/,
    ],
    [
      "HTTP 429 rate limiting",
      '429 {"error":{"message":"Rate limit reached for gpt-4o-mini. Please retry after 20s.","type":"tokens","code":"rate_limit_exceeded"}}',
      /Rate limit reached/,
    ],
    [
      "HTTP 503 service unavailability",
      '503 {"error":{"message":"The server is temporarily unable to handle the request.","type":"server_error"}}',
      /temporarily unable/,
    ],
    ["network ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:443", /ECONNREFUSED/],
    [
      "nested SDK JSON error",
      '400 {"error":{"message":"Invalid prompt: too long","type":"invalid_request_error"}}',
      /Invalid prompt: too long/,
    ],
    [
      "raw error message (no JSON)",
      "Something went wrong without JSON",
      /Something went wrong without JSON/,
    ],
  ])("throws clear error on %s", async (_label, errorMsg, expectedPattern) => {
    mockOpenAICreate.mockRejectedValue(new Error(errorMsg));

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(expectedPattern);
  });

  it("throws error on malformed LLM response (invalid JSON) with schema", async () => {
    mockOpenAICreate.mockResolvedValue(openAIResponse("This is not valid JSON {{{"));

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
    mockOpenAICreate.mockResolvedValue(
      openAIResponse('{"answer":"partial', { finish_reason: "length" }),
    );

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

  it("handles non-Error thrown values", async () => {
    mockOpenAICreate.mockRejectedValue("plain string error");

    const provider = new OpenAIProvider("key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/plain string error/);
  });

  it("includes token usage in successful response", async () => {
    mockOpenAICreate.mockResolvedValue(
      openAIResponse("Hello!", {
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const provider = new OpenAIProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("forwards messages array when provided", async () => {
    mockOpenAICreate.mockResolvedValue(openAIResponse("response"));

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
    mockOpenAICreate.mockResolvedValue(openAIResponse("response"));

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
    mockOpenAICreate.mockResolvedValue(openAIResponse("ok"));

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
    mockAnthropicCreate.mockResolvedValue(anthropicResponse("Hello!"));

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicResponse('"answer":"42"}'));

    const provider = new AnthropicProvider("key");
    const res = await provider.generate({ prompt: "q", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("adds assistant prefill when schema is provided", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicResponse('"answer":"x"}'));

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "q", schema: TestSchema });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.messages).toContainEqual({ role: "assistant", content: "{" });
  });

  it("passes temperature when provided", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicResponse("ok"));

    const provider = new AnthropicProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0 });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.temperature).toBe(0);
  });

  it("omits temperature when not provided", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicResponse("ok"));

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
    mockAxiosPost.mockResolvedValue(ollamaGenerateResponse("Hello!"));

    const provider = new OllamaProvider();
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    mockAxiosPost.mockResolvedValue(ollamaGenerateResponse('{"answer":"42"}'));

    const provider = new OllamaProvider();
    const res = await provider.generate({ prompt: "q", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("sends JSON Schema object (not string) when schema is provided", async () => {
    mockAxiosPost.mockResolvedValue(ollamaGenerateResponse('{"answer":"x"}'));

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
    mockAxiosPost.mockResolvedValue(ollamaGenerateResponse("ok"));

    const provider = new OllamaProvider("http://custom:9999");
    await provider.generate({ prompt: "Hi" });

    expect(mockAxiosPost.mock.calls[0][0]).toBe("http://custom:9999/api/generate");
  });

  it("passes temperature via options when provided", async () => {
    const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi", temperature: 0.5 });
    expect(call[1].options).toEqual({ temperature: 0.5 });
  });

  it("omits options when temperature not provided", async () => {
    const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi" });
    expect(call[1].options).toBeUndefined();
  });

  // ---------------------------------------------------------------
  // Token usage extraction
  // ---------------------------------------------------------------

  describe("token usage extraction", () => {
    it("extracts prompt_eval_count and eval_count from /api/generate", async () => {
      mockAxiosPost.mockResolvedValue(
        ollamaGenerateResponse("Hello!", { prompt_eval_count: 15, eval_count: 8 }),
      );

      const provider = new OllamaProvider();
      const res = await provider.generate({ prompt: "Hi" });

      expect(res.usage).toEqual({ promptTokens: 15, completionTokens: 8, totalTokens: 23 });
    });

    it("extracts prompt_eval_count and eval_count from /api/chat", async () => {
      mockAxiosPost.mockResolvedValue(
        ollamaChatResponse("Hello!", { prompt_eval_count: 20, eval_count: 12 }),
      );

      const provider = new OllamaProvider();
      const res = await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(res.usage).toEqual({ promptTokens: 20, completionTokens: 12, totalTokens: 32 });
    });

    it("returns undefined usage when counts missing", async () => {
      mockAxiosPost.mockResolvedValue(ollamaGenerateResponse("Hello!"));

      const provider = new OllamaProvider();
      const res = await provider.generate({ prompt: "Hi" });

      expect(res.usage).toBeUndefined();
    });

    it("returns undefined usage when only one count present", async () => {
      mockAxiosPost.mockResolvedValue(ollamaGenerateResponse("Hello!", { prompt_eval_count: 15 }));

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
      const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi" });
      expect(call[2]).toEqual({ timeout: 300_000 });
    });

    it("passes timeout config to axios.post for chat", async () => {
      mockAxiosPost.mockResolvedValue(ollamaChatResponse("ok"));

      const provider = new OllamaProvider();
      await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig).toEqual({ timeout: 300_000 });
    });

    it("passes timeout config to axios.get for listModels", async () => {
      mockAxiosGet.mockResolvedValue({ data: { models: [] } });

      const provider = new OllamaProvider();
      await provider.listModels();

      const axiosConfig = mockAxiosGet.mock.calls[0][1];
      expect(axiosConfig).toEqual({ timeout: 300_000 });
    });

    it("respects OLLAMA_TIMEOUT env var", async () => {
      process.env.OLLAMA_TIMEOUT = "600";
      const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi" });
      expect(call[2]).toEqual({ timeout: 600_000 });
      delete process.env.OLLAMA_TIMEOUT;
    });

    it("respects DOJOPS_REQUEST_TIMEOUT env var as fallback", async () => {
      process.env.DOJOPS_REQUEST_TIMEOUT = "900";
      const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi" });
      expect(call[2]).toEqual({ timeout: 900_000 });
      delete process.env.DOJOPS_REQUEST_TIMEOUT;
    });

    it("OLLAMA_TIMEOUT takes precedence over DOJOPS_REQUEST_TIMEOUT", async () => {
      process.env.OLLAMA_TIMEOUT = "600";
      process.env.DOJOPS_REQUEST_TIMEOUT = "900";
      const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi" });
      expect(call[2]).toEqual({ timeout: 600_000 });
      delete process.env.OLLAMA_TIMEOUT;
      delete process.env.DOJOPS_REQUEST_TIMEOUT;
    });

    it("throws timeout error with helpful message on ECONNABORTED", async () => {
      const err = new Error("timeout of 300000ms exceeded") as Error & {
        isAxiosError: boolean;
        code: string;
      };
      err.isAxiosError = true;
      err.code = "ECONNABORTED";
      mockAxiosPost.mockRejectedValue(err);

      const provider = new OllamaProvider();
      await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow(/timed out after 300s/);
    });
  });

  // ---------------------------------------------------------------
  // JSON Schema format
  // ---------------------------------------------------------------

  describe("JSON Schema format", () => {
    it("sends JSON Schema in chat mode too", async () => {
      mockAxiosPost.mockResolvedValue(ollamaChatResponse('{"answer":"x"}'));

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
      const call = await ollamaGenerateCall(new OllamaProvider(), { prompt: "Hi" });
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
    it.each([
      ["generate request", { prompt: "Hi" }, undefined],
      [
        "chat request",
        { prompt: "Hi", messages: [{ role: "user" as const, content: "Hi" }] },
        undefined,
      ],
      ["default constructor", { prompt: "Hi" }, undefined],
    ])("sends keep_alive='5m' in %s", async (_label, request) => {
      const isChat = !!(request as { messages?: unknown[] }).messages;
      mockAxiosPost.mockResolvedValue(
        isChat ? ollamaChatResponse("ok") : ollamaGenerateResponse("ok"),
      );

      const provider = new OllamaProvider();
      await provider.generate(request);

      const call = mockAxiosPost.mock.calls[0];
      expect(call[1].keep_alive).toBe("5m");
    });

    it("uses custom keep_alive when specified", async () => {
      const call = await ollamaGenerateCall(new OllamaProvider(undefined, undefined, "30m"), {
        prompt: "Hi",
      });
      expect(call[1].keep_alive).toBe("30m");
    });
  });

  // ---------------------------------------------------------------
  // TLS configuration
  // ---------------------------------------------------------------

  describe("TLS configuration", () => {
    const TLS_OLLAMA_URL = "https://ollama.internal:8443";

    it.each([
      ["default constructor", new OllamaProvider()],
      ["tlsRejectUnauthorized=true", new OllamaProvider(TLS_OLLAMA_URL, "llama3", "5m", true)],
    ])("does not include httpsAgent with %s", async (_label, provider) => {
      const call = await ollamaGenerateCall(provider, { prompt: "Hi" });
      expect(call[2].httpsAgent).toBeUndefined();
    });

    const tlsDisabledProvider = () => new OllamaProvider(TLS_OLLAMA_URL, "llama3", "5m", false);

    it("includes httpsAgent with rejectUnauthorized=false when TLS verification disabled", async () => {
      const call = await ollamaGenerateCall(tlsDisabledProvider(), { prompt: "Hi" });
      expect(call[2].httpsAgent).toBeDefined();
      expect(call[2].httpsAgent.options.rejectUnauthorized).toBe(false);
    });

    it("passes httpsAgent to listModels when TLS verification disabled", async () => {
      mockAxiosGet.mockResolvedValue({ data: { models: [] } });

      const provider = tlsDisabledProvider();
      await provider.listModels();

      const axiosConfig = mockAxiosGet.mock.calls[0][1];
      expect(axiosConfig.httpsAgent).toBeDefined();
      expect(axiosConfig.httpsAgent.options.rejectUnauthorized).toBe(false);
    });

    it("passes httpsAgent to chat requests when TLS verification disabled", async () => {
      mockAxiosPost.mockResolvedValue(ollamaChatResponse("ok"));

      const provider = tlsDisabledProvider();
      await provider.generate({
        prompt: "Hi",
        messages: [{ role: "user", content: "Hi" }],
      });

      const axiosConfig = mockAxiosPost.mock.calls[0][2];
      expect(axiosConfig.httpsAgent).toBeDefined();
    });
  });
});
