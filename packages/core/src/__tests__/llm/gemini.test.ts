import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "../../llm/gemini";

const TestSchema = z.object({ answer: z.string() });

// Mock native fetch
const mockFetch = vi.fn();

function mockGenerateResponse(text: string | null, extra?: Record<string, unknown>) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      candidates: [
        {
          content: { parts: text !== null ? [{ text }] : [] },
          finishReason: "STOP",
        },
      ],
      ...extra,
    }),
  };
}

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has name 'gemini'", () => {
    expect(new GeminiProvider("key").name).toBe("gemini");
  });

  it("defaults to gemini-2.5-flash model", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse("Hi"));

    const provider = new GeminiProvider("key");
    await provider.generate({ prompt: "Hi" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/models/gemini-2.5-flash:generateContent");
  });

  it("generates plain text response", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse("Hello!"));

    const provider = new GeminiProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    const json = JSON.stringify({ answer: "42" });
    mockFetch.mockResolvedValue(mockGenerateResponse(json));

    const provider = new GeminiProvider("key");
    const res = await provider.generate({ prompt: "question", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("sets responseMimeType when schema is provided", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse('{"answer":"x"}'));

    const provider = new GeminiProvider("key");
    await provider.generate({
      prompt: "q",
      system: "Be helpful.",
      schema: TestSchema,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toContain("Be helpful.");
    expect(body.systemInstruction.parts[0].text).toContain("valid JSON");
  });

  it("handles null text gracefully", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse(null));

    const provider = new GeminiProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("");
  });

  it("lists available models", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        models: [
          { name: "models/gemini-2.5-flash" },
          { name: "models/gemini-2.5-pro" },
          { name: "models/text-embedding-004" },
        ],
      }),
    });

    const provider = new GeminiProvider("key");
    const models = await provider.listModels();

    expect(models).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });

  it("passes temperature in config when provided", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse("ok"));

    const provider = new GeminiProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0.9 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBe(0.9);
  });

  it("omits temperature from config when not provided", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse("ok"));

    const provider = new GeminiProvider("key");
    await provider.generate({ prompt: "Hi" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.generationConfig.temperature).toBeUndefined();
  });

  it("includes API key in URL", async () => {
    mockFetch.mockResolvedValue(mockGenerateResponse("ok"));

    const provider = new GeminiProvider("test-api-key-123");
    await provider.generate({ prompt: "Hi" });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("key=test-api-key-123");
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue("Invalid API key"),
    });

    const provider = new GeminiProvider("bad-key");
    await expect(provider.generate({ prompt: "Hi" })).rejects.toThrow("Gemini API error 401");
  });

  it("returns empty array when listModels fails", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const provider = new GeminiProvider("key");
    const models = await provider.listModels();

    expect(models).toEqual([]);
  });
});
