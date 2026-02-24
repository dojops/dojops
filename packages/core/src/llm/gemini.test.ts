import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { GeminiProvider } from "./gemini";

const TestSchema = z.object({ answer: z.string() });

const mockGenerateContent = vi.fn();
const mockModelsList = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent, list: mockModelsList };
  },
}));

describe("GeminiProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has name 'gemini'", () => {
    expect(new GeminiProvider("key").name).toBe("gemini");
  });

  it("defaults to gemini-2.5-flash model", async () => {
    mockGenerateContent.mockResolvedValue({ text: "Hi" });

    const provider = new GeminiProvider("key");
    await provider.generate({ prompt: "Hi" });

    expect(mockGenerateContent.mock.calls[0][0].model).toBe("gemini-2.5-flash");
  });

  it("generates plain text response", async () => {
    mockGenerateContent.mockResolvedValue({ text: "Hello!" });

    const provider = new GeminiProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    const json = JSON.stringify({ answer: "42" });
    mockGenerateContent.mockResolvedValue({ text: json });

    const provider = new GeminiProvider("key");
    const res = await provider.generate({ prompt: "question", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("sets responseMimeType when schema is provided", async () => {
    mockGenerateContent.mockResolvedValue({ text: '{"answer":"x"}' });

    const provider = new GeminiProvider("key");
    await provider.generate({
      prompt: "q",
      system: "Be helpful.",
      schema: TestSchema,
    });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.systemInstruction).toContain("Be helpful.");
    expect(call.config.systemInstruction).toContain("valid JSON");
  });

  it("handles null text gracefully", async () => {
    mockGenerateContent.mockResolvedValue({ text: null });

    const provider = new GeminiProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("");
  });

  it("lists available models", async () => {
    mockModelsList.mockResolvedValue({
      page: [
        { name: "models/gemini-2.5-flash" },
        { name: "models/gemini-2.5-pro" },
        { name: "models/text-embedding-004" },
      ],
    });

    const provider = new GeminiProvider("key");
    const models = await provider.listModels();

    expect(models).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });

  it("passes temperature in config when provided", async () => {
    mockGenerateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0.9 });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.temperature).toBe(0.9);
  });

  it("omits temperature from config when not provided", async () => {
    mockGenerateContent.mockResolvedValue({ text: "ok" });

    const provider = new GeminiProvider("key");
    await provider.generate({ prompt: "Hi" });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.temperature).toBeUndefined();
  });
});
