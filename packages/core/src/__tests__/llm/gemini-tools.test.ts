import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

const mockFetch = vi.fn();

// ── Gemini response helpers tested through public API ───────────────

describe("GeminiProvider response helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getProvider() {
    const { GeminiProvider } = await import("../../llm/gemini");
    return new GeminiProvider("key", "gemini-2.5-flash");
  }

  // ── extractText ─────────────────────────────────────────────────

  describe("text extraction from response", () => {
    it("concatenates multiple text parts", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: "Part 1. " }, { text: "Part 2." }],
              },
              finishReason: "STOP",
            },
          ],
        }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.content).toBe("Part 1. Part 2.");
    });

    it("skips non-text parts", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [
            {
              content: {
                parts: [{ text: "text" }, { inlineData: { mimeType: "image/png", data: "..." } }],
              },
              finishReason: "STOP",
            },
          ],
        }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.content).toBe("text");
    });

    it("returns empty string when no candidates", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ candidates: [] }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.content).toBe("");
    });

    it("returns empty string when parts are undefined", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: {}, finishReason: "STOP" }],
        }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.content).toBe("");
    });
  });

  // ── extractUsage ────────────────────────────────────────────────

  describe("usage extraction", () => {
    it("extracts promptTokenCount and candidatesTokenCount", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 30,
            candidatesTokenCount: 15,
            totalTokenCount: 45,
          },
        }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.usage).toEqual({
        promptTokens: 30,
        completionTokens: 15,
        totalTokens: 45,
      });
    });

    it("returns undefined usage when no usageMetadata", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.usage).toBeUndefined();
    });

    it("defaults missing counts to 0", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
          usageMetadata: {},
        }),
      });

      const provider = await getProvider();
      const res = await provider.generate({ prompt: "Hi" });
      expect(res.usage).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });
  });

  // ── SAFETY finish reason ────────────────────────────────────────

  describe("safety filter handling", () => {
    it("throws on SAFETY finish reason", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "SAFETY" }],
        }),
      });

      const provider = await getProvider();
      await expect(provider.generate({ prompt: "bad" })).rejects.toThrow(
        /blocked by safety filters/,
      );
    });

    it("throws on MAX_TOKENS with schema", async () => {
      const TestSchema = z.object({ answer: z.string() });
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [
            { content: { parts: [{ text: '{"answer":' }] }, finishReason: "MAX_TOKENS" },
          ],
        }),
      });

      const provider = await getProvider();
      await expect(provider.generate({ prompt: "q", schema: TestSchema })).rejects.toThrow(
        /truncated/i,
      );
    });
  });

  // ── Multi-turn messages ─────────────────────────────────────────

  describe("message mapping", () => {
    it("maps user and assistant roles correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "reply" }] }, finishReason: "STOP" }],
        }),
      });

      const provider = await getProvider();
      await provider.generate({
        prompt: "",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "Question" },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toHaveLength(3);
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[1].role).toBe("model");
      expect(body.contents[2].role).toBe("user");
    });

    it("filters system messages from contents", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        }),
      });

      const provider = await getProvider();
      await provider.generate({
        prompt: "",
        system: "Be concise",
        messages: [
          { role: "system", content: "Extra system" },
          { role: "user", content: "Hello" },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // System messages filtered from contents, system goes to systemInstruction
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe("user");
      expect(body.systemInstruction.parts[0].text).toContain("Be concise");
    });
  });
});

// ── Gemini tool-calling content mapping ─────────────────────────────

describe("GeminiProvider tool-calling content mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getProvider() {
    const { GeminiProvider } = await import("../../llm/gemini");
    return new GeminiProvider("key", "gemini-2.5-flash");
  }

  const readFileTool = {
    name: "read_file",
    description: "Read a file",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  };

  it("maps multi-turn tool conversation correctly", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "Done" }] }, finishReason: "STOP" }],
      }),
    });

    const provider = await getProvider();
    await provider.generateWithTools!({
      system: "Agent",
      messages: [
        { role: "user", content: "Read the config" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "config.json" } }],
        },
        { role: "tool", callId: "call_1", content: '{"port": 3000}' },
        { role: "assistant", content: "The config has port 3000" },
        { role: "user", content: "Change it to 8080" },
      ],
      tools: [readFileTool],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const contents = body.contents;

    // user message
    expect(contents[0].role).toBe("user");
    expect(contents[0].parts[0].text).toBe("Read the config");

    // assistant with functionCall
    expect(contents[1].role).toBe("model");
    expect(contents[1].parts).toContainEqual(
      expect.objectContaining({
        functionCall: { name: "read_file", args: { path: "config.json" } },
      }),
    );

    // tool result as functionResponse
    expect(contents[2].role).toBe("function");
    expect(contents[2].parts[0].functionResponse.name).toBe("read_file");

    // assistant text
    expect(contents[3].role).toBe("model");
    expect(contents[3].parts[0].text).toBe("The config has port 3000");

    // user follow-up
    expect(contents[4].role).toBe("user");
  });

  it("uses callId-to-name lookup for tool result function name", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      }),
    });

    const provider = await getProvider();
    await provider.generateWithTools!({
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "id_a", name: "read_file", arguments: { path: "x" } },
            { id: "id_b", name: "run_cmd", arguments: { command: "ls" } },
          ],
        },
        { role: "tool", callId: "id_a", content: "file content" },
        { role: "tool", callId: "id_b", content: "output" },
      ],
      tools: [
        readFileTool,
        { name: "run_cmd", description: "Run cmd", parameters: { type: "object", properties: {} } },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const functionResults = body.contents.filter((c: { role: string }) => c.role === "function");
    expect(functionResults).toHaveLength(2);
    expect(functionResults[0].parts[0].functionResponse.name).toBe("read_file");
    expect(functionResults[1].parts[0].functionResponse.name).toBe("run_cmd");
  });

  it("falls back to 'tool' name when callId not found in lookup", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      }),
    });

    const provider = await getProvider();
    await provider.generateWithTools!({
      messages: [
        { role: "user", content: "go" },
        { role: "tool", callId: "unknown_id", content: "data" },
      ],
      tools: [readFileTool],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const fnResult = body.contents.find((c: { role: string }) => c.role === "function");
    expect(fnResult.parts[0].functionResponse.name).toBe("tool");
  });

  it("passes temperature for tool-calling requests", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      }),
    });

    const provider = await getProvider();
    await provider.generateWithTools!({
      messages: [{ role: "user", content: "Hi" }],
      tools: [readFileTool],
      temperature: 0.1,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBe(0.1);
  });

  it("omits systemInstruction when system is undefined", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
      }),
    });

    const provider = await getProvider();
    await provider.generateWithTools!({
      messages: [{ role: "user", content: "Hi" }],
      tools: [readFileTool],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.systemInstruction).toBeUndefined();
  });
});
