import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "../../llm/openai";
import { DeepSeekProvider } from "../../llm/deepseek";
import { AnthropicProvider } from "../../llm/anthropic";
import { OllamaProvider } from "../../llm/ollama";
import type { LLMToolRequest } from "../../llm/tool-types";

// ── Mocks ────────────────────────────────────────────────────────────

const { mockOpenAICreate, mockAnthropicCreate, mockAxiosPost, mockAxiosGet, mockFetch } =
  vi.hoisted(() => ({
    mockOpenAICreate: vi.fn(),
    mockAnthropicCreate: vi.fn(),
    mockAxiosPost: vi.fn(),
    mockAxiosGet: vi.fn(),
    mockFetch: vi.fn(),
  }));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockOpenAICreate } };
    models = { list: vi.fn() };
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockAnthropicCreate, stream: vi.fn() };
    models = { list: vi.fn().mockResolvedValue({ data: [] }) };
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

// ── Shared fixtures ─────────────────────────────────────────────────

const READ_FILE_TOOL = {
  name: "read_file",
  description: "Read a file from disk",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};

const RUN_COMMAND_TOOL = {
  name: "run_command",
  description: "Run a shell command",
  parameters: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

function makeToolRequest(overrides?: Partial<LLMToolRequest>): LLMToolRequest {
  return {
    system: "You are a DevOps assistant",
    messages: [{ role: "user", content: "Read the Makefile" }],
    tools: [READ_FILE_TOOL, RUN_COMMAND_TOOL],
    ...overrides,
  };
}

function openAIToolResponse(
  content: string | null,
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>,
  finishReason = "stop",
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
  return {
    choices: [
      {
        message: {
          content,
          tool_calls: toolCalls?.map((tc) => ({ ...tc, type: "function" })),
        },
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

function anthropicToolResponse(
  blocks: Array<Record<string, unknown>>,
  stopReason = "end_turn",
  usage?: { input_tokens: number; output_tokens: number },
) {
  return {
    content: blocks,
    stop_reason: stopReason,
    ...(usage ? { usage } : {}),
  };
}

function geminiToolResponse(
  parts: Array<Record<string, unknown>>,
  finishReason = "STOP",
  usageMetadata?: Record<string, number>,
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      candidates: [{ content: { parts }, finishReason }],
      ...(usageMetadata ? { usageMetadata } : {}),
    }),
  };
}

// ── OpenAI-compat tool calling (OpenAI, DeepSeek, Mistral, Copilot) ─

describe("OpenAI-compat generateWithTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends tools as function declarations in OpenAI format", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("done"));

    const provider = new OpenAIProvider("key");
    await provider.generateWithTools(makeToolRequest());

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.tools).toHaveLength(2);
    expect(call.tools[0]).toEqual({
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file from disk",
        parameters: READ_FILE_TOOL.parameters,
      },
    });
  });

  it("maps system message correctly", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("done"));

    const provider = new OpenAIProvider("key");
    await provider.generateWithTools(makeToolRequest());

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.messages[0]).toEqual({
      role: "system",
      content: "You are a DevOps assistant",
    });
  });

  it("parses tool calls from response", async () => {
    mockOpenAICreate.mockResolvedValue(
      openAIToolResponse(
        null,
        [
          {
            id: "call_abc123",
            function: { name: "read_file", arguments: '{"path":"Makefile"}' },
          },
        ],
        "tool_calls",
      ),
    );

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].id).toBe("call_abc123");
    expect(res.toolCalls[0].name).toBe("read_file");
    expect(res.toolCalls[0].arguments).toEqual({ path: "Makefile" });
    expect(res.stopReason).toBe("tool_use");
  });

  it("handles multiple simultaneous tool calls", async () => {
    mockOpenAICreate.mockResolvedValue(
      openAIToolResponse(
        null,
        [
          { id: "call_1", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
          { id: "call_2", function: { name: "read_file", arguments: '{"path":"b.ts"}' } },
        ],
        "tool_calls",
      ),
    );

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls).toHaveLength(2);
    expect(res.toolCalls[0].id).toBe("call_1");
    expect(res.toolCalls[1].id).toBe("call_2");
  });

  it("returns end_turn when no tool calls", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("All done!", undefined, "stop"));

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.content).toBe("All done!");
    expect(res.toolCalls).toHaveLength(0);
    expect(res.stopReason).toBe("end_turn");
  });

  it("returns max_tokens when truncated", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("partial", undefined, "length"));

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.stopReason).toBe("max_tokens");
  });

  it("extracts token usage from response", async () => {
    mockOpenAICreate.mockResolvedValue(
      openAIToolResponse("done", undefined, "stop", {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      }),
    );

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
  });

  it("extracts cached tokens from response", async () => {
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 80 },
      },
    });

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.usage?.cacheReadTokens).toBe(80);
  });

  it("handles invalid JSON in tool call arguments gracefully", async () => {
    mockOpenAICreate.mockResolvedValue(
      openAIToolResponse(
        null,
        [{ id: "call_bad", function: { name: "read_file", arguments: '{"path": broken' } }],
        "tool_calls",
      ),
    );

    const provider = new OpenAIProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls[0].arguments).toEqual({});
  });

  it("throws on empty choices", async () => {
    mockOpenAICreate.mockResolvedValue({ choices: [] });

    const provider = new OpenAIProvider("key");
    await expect(provider.generateWithTools(makeToolRequest())).rejects.toThrow(/empty choices/);
  });

  it("throws on API error with readable message", async () => {
    mockOpenAICreate.mockRejectedValue(
      new Error('429 {"error":{"message":"Rate limit exceeded"}}'),
    );

    const provider = new OpenAIProvider("key");
    await expect(provider.generateWithTools(makeToolRequest())).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  it("maps tool result messages with isError prefix", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("Fixed it"));

    const provider = new OpenAIProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "Read this file" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "x" } }],
        },
        { role: "tool", callId: "call_1", content: "File not found", isError: true },
      ],
    });

    const call = mockOpenAICreate.mock.calls[0][0];
    const toolMsg = call.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.content).toContain("[TOOL ERROR]");
    expect(toolMsg.content).toContain("File not found");
  });

  it("maps assistant tool_calls messages correctly", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("ok"));

    const provider = new OpenAIProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: "I'll read the file",
          toolCalls: [{ id: "tc_1", name: "read_file", arguments: { path: "f.ts" } }],
        },
        { role: "tool", callId: "tc_1", content: "file contents" },
      ],
    });

    const call = mockOpenAICreate.mock.calls[0][0];
    const assistantMsg = call.messages.find(
      (m: Record<string, unknown>) => m.role === "assistant" && m.tool_calls,
    );
    expect(assistantMsg.tool_calls[0].function.name).toBe("read_file");
    expect(assistantMsg.tool_calls[0].function.arguments).toBe('{"path":"f.ts"}');
  });

  it("passes maxTokens and temperature to API", async () => {
    mockOpenAICreate.mockResolvedValue(openAIToolResponse("ok"));

    const provider = new OpenAIProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      temperature: 0.2,
      maxTokens: 4096,
    });

    const call = mockOpenAICreate.mock.calls[0][0];
    expect(call.temperature).toBe(0.2);
    expect(call.max_tokens).toBe(4096);
  });

  it("DeepSeek delegates to openaiCompatGenerateWithTools", async () => {
    mockOpenAICreate.mockResolvedValue(
      openAIToolResponse(
        null,
        [{ id: "call_ds", function: { name: "read_file", arguments: '{"path":"x"}' } }],
        "tool_calls",
      ),
    );

    const provider = new DeepSeekProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe("read_file");
    expect(res.stopReason).toBe("tool_use");
  });
});

// ── Anthropic tool calling ──────────────────────────────────────────

describe("Anthropic generateWithTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends tools as Anthropic-formatted input_schema", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "done" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools(makeToolRequest());

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.tools).toHaveLength(2);
    expect(call.tools[0].name).toBe("read_file");
    expect(call.tools[0].input_schema).toEqual(READ_FILE_TOOL.parameters);
  });

  it("parses tool_use blocks from response", async () => {
    mockAnthropicCreate.mockResolvedValue(
      anthropicToolResponse(
        [
          { type: "text", text: "Reading the file..." },
          {
            type: "tool_use",
            id: "toolu_01abc",
            name: "read_file",
            input: { path: "Makefile" },
          },
        ],
        "tool_use",
      ),
    );

    const provider = new AnthropicProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.content).toBe("Reading the file...");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].id).toBe("toolu_01abc");
    expect(res.toolCalls[0].name).toBe("read_file");
    expect(res.toolCalls[0].arguments).toEqual({ path: "Makefile" });
    expect(res.stopReason).toBe("tool_use");
  });

  it("handles multiple tool_use blocks", async () => {
    mockAnthropicCreate.mockResolvedValue(
      anthropicToolResponse(
        [
          { type: "tool_use", id: "tc_1", name: "read_file", input: { path: "a" } },
          { type: "tool_use", id: "tc_2", name: "run_command", input: { command: "ls" } },
        ],
        "tool_use",
      ),
    );

    const provider = new AnthropicProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls).toHaveLength(2);
    expect(res.toolCalls[0].name).toBe("read_file");
    expect(res.toolCalls[1].name).toBe("run_command");
  });

  it("maps stop_reason to stopReason enum", async () => {
    const cases: Array<[string, string]> = [
      ["end_turn", "end_turn"],
      ["tool_use", "tool_use"],
      ["max_tokens", "max_tokens"],
    ];

    for (const [anthropicReason, expected] of cases) {
      mockAnthropicCreate.mockResolvedValue(
        anthropicToolResponse([{ type: "text", text: "x" }], anthropicReason),
      );

      const provider = new AnthropicProvider("key");
      const res = await provider.generateWithTools(makeToolRequest());
      expect(res.stopReason).toBe(expected);
    }
  });

  it("maps tool result messages as tool_result content blocks", async () => {
    mockAnthropicCreate.mockResolvedValue(
      anthropicToolResponse([{ type: "text", text: "Got it" }]),
    );

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          content: "Reading...",
          toolCalls: [{ id: "tc_1", name: "read_file", arguments: { path: "x" } }],
        },
        { role: "tool", callId: "tc_1", content: "file data here" },
      ],
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    // Tool results are mapped to user role with tool_result content
    const toolResultMsg = call.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "user" && Array.isArray(m.content) && m.content[0]?.type === "tool_result",
    );
    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg.content[0].tool_use_id).toBe("tc_1");
    expect(toolResultMsg.content[0].content).toBe("file data here");
  });

  it("maps tool error results with is_error flag", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "retry" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "try" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc_err", name: "read_file", arguments: { path: "x" } }],
        },
        { role: "tool", callId: "tc_err", content: "Permission denied", isError: true },
      ],
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    const toolResultMsg = call.messages.find(
      (m: { role: string; content: unknown }) => m.role === "user" && Array.isArray(m.content),
    );
    expect(toolResultMsg.content[0].is_error).toBe(true);
  });

  it("maps assistant messages with tool_use content blocks", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "ok" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: "On it",
          toolCalls: [{ id: "tc_x", name: "read_file", arguments: { path: "y" } }],
        },
        { role: "tool", callId: "tc_x", content: "data" },
      ],
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    const assistantMsg = call.messages.find(
      (m: { role: string; content: unknown }) => m.role === "assistant" && Array.isArray(m.content),
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toContainEqual({ type: "text", text: "On it" });
    expect(assistantMsg.content).toContainEqual(
      expect.objectContaining({ type: "tool_use", id: "tc_x", name: "read_file" }),
    );
  });

  it("extracts usage with cache tokens", async () => {
    mockAnthropicCreate.mockResolvedValue(
      anthropicToolResponse([{ type: "text", text: "ok" }], "end_turn", {
        input_tokens: 200,
        output_tokens: 80,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 30,
      } as unknown as { input_tokens: number; output_tokens: number }),
    );

    const provider = new AnthropicProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.usage).toEqual({
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      cacheCreationTokens: 50,
      cacheReadTokens: 30,
    });
  });

  it("extracts thinking blocks from response", async () => {
    mockAnthropicCreate.mockResolvedValue(
      anthropicToolResponse(
        [
          { type: "thinking", thinking: "Let me analyze this step by step..." },
          { type: "text", text: "Here's what I found" },
          { type: "tool_use", id: "tc_think", name: "read_file", input: { path: "x" } },
        ],
        "tool_use",
      ),
    );

    const provider = new AnthropicProvider("key");
    const res = await provider.generateWithTools({
      ...makeToolRequest(),
      thinking: "medium",
    });

    expect(res.thinking).toBe("Let me analyze this step by step...");
    expect(res.content).toBe("Here's what I found");
    expect(res.toolCalls).toHaveLength(1);
  });

  it("passes thinking parameters when thinking level is set", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "ok" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      thinking: "high",
      maxTokens: 4096,
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    // max_tokens must be > budget_tokens
    expect(call.max_tokens).toBeGreaterThan(32768);
  });

  it("omits temperature when thinking is enabled", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "ok" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      thinking: "low",
      temperature: 0.5,
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    // Anthropic requires temperature to be omitted when thinking is enabled
    expect(call.temperature).toBeUndefined();
  });

  it("passes temperature when thinking is none", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "ok" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      thinking: "none",
      temperature: 0.7,
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    expect(call.temperature).toBe(0.7);
    expect(call.thinking).toBeUndefined();
  });

  it("filters system messages from agent messages", async () => {
    mockAnthropicCreate.mockResolvedValue(anthropicToolResponse([{ type: "text", text: "ok" }]));

    const provider = new AnthropicProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "system", content: "Should be filtered" },
        { role: "user", content: "Hello" },
      ],
    });

    const call = mockAnthropicCreate.mock.calls[0][0];
    const roles = call.messages.map((m: { role: string }) => m.role);
    expect(roles).not.toContain("system");
    // system goes to the top-level system param, not messages
    expect(call.system).toBe("You are a DevOps assistant");
  });

  it("throws on API error", async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('{"error":{"message":"Overloaded"}}'));

    const provider = new AnthropicProvider("key");
    await expect(provider.generateWithTools(makeToolRequest())).rejects.toThrow("Overloaded");
  });
});

// ── Gemini tool calling ─────────────────────────────────────────────

describe("Gemini generateWithTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends tools as functionDeclarations", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ text: "done" }]));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    await provider.generateWithTools(makeToolRequest());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].functionDeclarations).toHaveLength(2);
    expect(body.tools[0].functionDeclarations[0].name).toBe("read_file");
  });

  it("sends system instruction as top-level param", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ text: "done" }]));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    await provider.generateWithTools(makeToolRequest());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe("You are a DevOps assistant");
  });

  it("parses functionCall parts as tool calls", async () => {
    mockFetch.mockResolvedValue(
      geminiToolResponse([
        { text: "I'll read the file" },
        { functionCall: { name: "read_file", args: { path: "Makefile" } } },
      ]),
    );

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.content).toBe("I'll read the file");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe("read_file");
    expect(res.toolCalls[0].arguments).toEqual({ path: "Makefile" });
    expect(res.toolCalls[0].id).toBe("gemini-call-0");
    expect(res.stopReason).toBe("tool_use");
  });

  it("handles multiple functionCall parts", async () => {
    mockFetch.mockResolvedValue(
      geminiToolResponse([
        { functionCall: { name: "read_file", args: { path: "a" } } },
        { functionCall: { name: "run_command", args: { command: "ls" } } },
      ]),
    );

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls).toHaveLength(2);
    expect(res.toolCalls[0].id).toBe("gemini-call-0");
    expect(res.toolCalls[1].id).toBe("gemini-call-1");
  });

  it("returns end_turn when no function calls", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ text: "All done" }]));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.content).toBe("All done");
    expect(res.toolCalls).toHaveLength(0);
    expect(res.stopReason).toBe("end_turn");
  });

  it("returns max_tokens on MAX_TOKENS finish reason", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ text: "partial" }], "MAX_TOKENS"));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.stopReason).toBe("max_tokens");
  });

  it("extracts usage metadata", async () => {
    mockFetch.mockResolvedValue(
      geminiToolResponse([{ text: "done" }], "STOP", {
        promptTokenCount: 150,
        candidatesTokenCount: 40,
        totalTokenCount: 190,
      }),
    );

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.usage).toEqual({
      promptTokens: 150,
      completionTokens: 40,
      totalTokens: 190,
    });
  });

  it("maps tool result messages as functionResponse parts", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ text: "ok" }]));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc_g", name: "read_file", arguments: { path: "x" } }],
        },
        { role: "tool", callId: "tc_g", content: "file content" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const toolResultContent = body.contents.find((c: { role: string }) => c.role === "function");
    expect(toolResultContent).toBeDefined();
    expect(toolResultContent.parts[0].functionResponse.name).toBe("read_file");
    expect(toolResultContent.parts[0].functionResponse.response.result).toBe("file content");
  });

  it("maps assistant tool_calls as functionCall parts", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ text: "ok" }]));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "do it" },
        {
          role: "assistant",
          content: "On it",
          toolCalls: [{ id: "tc_g2", name: "run_command", arguments: { command: "ls" } }],
        },
        { role: "tool", callId: "tc_g2", content: "output" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const modelContent = body.contents.find((c: { role: string }) => c.role === "model");
    expect(modelContent).toBeDefined();
    expect(modelContent.parts).toContainEqual(expect.objectContaining({ text: "On it" }));
    expect(modelContent.parts).toContainEqual(
      expect.objectContaining({
        functionCall: { name: "run_command", args: { command: "ls" } },
      }),
    );
  });

  it("handles functionCall without args", async () => {
    mockFetch.mockResolvedValue(geminiToolResponse([{ functionCall: { name: "read_file" } }]));

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls[0].arguments).toEqual({});
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue("Bad request"),
    });

    const provider = new (await import("../../llm/gemini")).GeminiProvider("key");
    await expect(provider.generateWithTools(makeToolRequest())).rejects.toThrow(
      "Gemini API error 400",
    );
  });
});

// ── Ollama prompt-based tool calling ────────────────────────────────

describe("Ollama generateWithTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("embeds tools in system prompt via buildToolCallingSystemPrompt", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: '{"text": "Hello"}' } },
    });

    const provider = new OllamaProvider();
    await provider.generateWithTools(makeToolRequest());

    const call = mockAxiosPost.mock.calls[0];
    const systemMsg = call[1].messages.find((m: { role: string }) => m.role === "system");
    expect(systemMsg.content).toContain("## Available Tools");
    expect(systemMsg.content).toContain("read_file");
    expect(systemMsg.content).toContain("run_command");
    expect(systemMsg.content).toContain("tool_calls");
  });

  it("parses tool_calls from LLM text output", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        message: {
          content: '{"tool_calls": [{"name": "read_file", "arguments": {"path": "Makefile"}}]}',
        },
      },
    });

    const provider = new OllamaProvider();
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe("read_file");
    expect(res.toolCalls[0].arguments).toEqual({ path: "Makefile" });
    expect(res.stopReason).toBe("tool_use");
  });

  it("parses text response from LLM output", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: '{"text": "The build succeeded"}' } },
    });

    const provider = new OllamaProvider();
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.content).toBe("The build succeeded");
    expect(res.toolCalls).toHaveLength(0);
    expect(res.stopReason).toBe("end_turn");
  });

  it("handles done tool call as end_turn", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        message: {
          content: '{"tool_calls": [{"name": "done", "arguments": {"summary": "Completed"}}]}',
        },
      },
    });

    const provider = new OllamaProvider();
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.stopReason).toBe("end_turn");
    expect(res.toolCalls[0].name).toBe("done");
  });

  it("falls back to plain text when LLM doesn't produce valid JSON", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: "I can help you with that." } },
    });

    const provider = new OllamaProvider();
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.content).toBe("I can help you with that.");
    expect(res.toolCalls).toHaveLength(0);
  });

  it("maps tool result messages as user messages", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: '{"text": "ok"}' } },
    });

    const provider = new OllamaProvider();
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "Read it" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc_oll", name: "read_file", arguments: { path: "x" } }],
        },
        { role: "tool", callId: "tc_oll", content: "file data" },
      ],
    });

    const call = mockAxiosPost.mock.calls[0];
    const msgs = call[1].messages;
    // Tool results become user messages with prefix
    const toolMsg = msgs.find(
      (m: { role: string; content: string }) =>
        m.role === "user" && m.content.includes("Tool result"),
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toContain("tc_oll");
    expect(toolMsg.content).toContain("file data");
  });

  it("reconstructs assistant tool call messages as JSON", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: '{"text": "ok"}' } },
    });

    const provider = new OllamaProvider();
    await provider.generateWithTools({
      ...makeToolRequest(),
      messages: [
        { role: "user", content: "do" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "tc_r", name: "read_file", arguments: { path: "a" } }],
        },
        { role: "tool", callId: "tc_r", content: "data" },
      ],
    });

    const call = mockAxiosPost.mock.calls[0];
    const assistantMsg = call[1].messages.find(
      (m: { role: string; content: string }) =>
        m.role === "assistant" && m.content.includes("tool_calls"),
    );
    expect(assistantMsg).toBeDefined();
    const parsed = JSON.parse(assistantMsg.content);
    expect(parsed.tool_calls[0].name).toBe("read_file");
  });

  it("extracts token usage from response", async () => {
    mockAxiosPost.mockResolvedValue({
      data: {
        message: { content: '{"text": "ok"}' },
        prompt_eval_count: 100,
        eval_count: 25,
      },
    });

    const provider = new OllamaProvider();
    const res = await provider.generateWithTools(makeToolRequest());

    expect(res.usage).toEqual({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
    });
  });

  it("passes temperature via options", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: '{"text": "ok"}' } },
    });

    const provider = new OllamaProvider();
    await provider.generateWithTools({
      ...makeToolRequest(),
      temperature: 0.3,
    });

    const call = mockAxiosPost.mock.calls[0];
    expect(call[1].options).toEqual({ temperature: 0.3 });
  });

  it("sends keep_alive in tool-calling request", async () => {
    mockAxiosPost.mockResolvedValue({
      data: { message: { content: '{"text": "ok"}' } },
    });

    const provider = new OllamaProvider(undefined, undefined, "10m");
    await provider.generateWithTools(makeToolRequest());

    const call = mockAxiosPost.mock.calls[0];
    expect(call[1].keep_alive).toBe("10m");
  });

  it("throws wrapped error on connection failure", async () => {
    const err = new Error("connect ECONNREFUSED") as Error & {
      isAxiosError: boolean;
      code: string;
    };
    err.isAxiosError = true;
    err.code = "ECONNREFUSED";
    mockAxiosPost.mockRejectedValue(err);

    const provider = new OllamaProvider();
    await expect(provider.generateWithTools(makeToolRequest())).rejects.toThrow(
      /Cannot connect to Ollama/,
    );
  });
});
