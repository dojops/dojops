import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { DeepSeekProvider } from "./deepseek";

const TestSchema = z.object({ answer: z.string() });

const mockCreate = vi.fn();
const mockModelsList = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: mockCreate } };
    models = { list: mockModelsList };
  },
}));

describe("DeepSeekProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has name 'deepseek'", () => {
    expect(new DeepSeekProvider("key").name).toBe("deepseek");
  });

  it("defaults to deepseek-chat model", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hi" } }],
    });

    const provider = new DeepSeekProvider("key");
    await provider.generate({ prompt: "Hi" });

    expect(mockCreate.mock.calls[0][0].model).toBe("deepseek-chat");
  });

  it("generates plain text response", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "Hello!" } }],
    });

    const provider = new DeepSeekProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("Hello!");
    expect(res.parsed).toBeUndefined();
  });

  it("generates structured JSON response with schema", async () => {
    const json = JSON.stringify({ answer: "42" });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: json } }],
    });

    const provider = new DeepSeekProvider("key");
    const res = await provider.generate({ prompt: "question", schema: TestSchema });

    expect(res.parsed).toEqual({ answer: "42" });
  });

  it("appends JSON instruction to system prompt when schema is provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '{"answer":"x"}' } }],
    });

    const provider = new DeepSeekProvider("key");
    await provider.generate({
      prompt: "q",
      system: "Be helpful.",
      schema: TestSchema,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain("Be helpful.");
    expect(call.messages[0].content).toContain("valid JSON");
    expect(call.response_format).toEqual({ type: "json_object" });
  });

  it("handles null content gracefully", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    const provider = new DeepSeekProvider("key");
    const res = await provider.generate({ prompt: "Hi" });

    expect(res.content).toBe("");
  });

  it("lists available models", async () => {
    mockModelsList.mockResolvedValue([{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }]);

    const provider = new DeepSeekProvider("key");
    const models = await provider.listModels();

    expect(models).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("passes temperature when provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });

    const provider = new DeepSeekProvider("key");
    await provider.generate({ prompt: "Hi", temperature: 0.3 });

    const call = mockCreate.mock.calls[0][0];
    expect(call.temperature).toBe(0.3);
  });

  it("omits temperature when not provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
    });

    const provider = new DeepSeekProvider("key");
    await provider.generate({ prompt: "Hi" });

    const call = mockCreate.mock.calls[0][0];
    expect(call.temperature).toBeUndefined();
  });
});
