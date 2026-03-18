import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock copilot-auth
vi.mock("../../llm/copilot-auth", () => ({
  getValidCopilotToken: vi.fn().mockResolvedValue({
    token: "test-token",
    apiBaseUrl: "https://api.github.com/copilot",
  }),
}));

const mockStreamChunks = [
  { choices: [{ delta: { content: "Streamed " } }], usage: null },
  { choices: [{ delta: { content: "output" } }], usage: null },
  { choices: [{ delta: {} }], usage: { prompt_tokens: 50, completion_tokens: 20 } },
];

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

// Mock OpenAI SDK as a class
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
    models = {
      list: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          // empty
        },
      }),
    };
  },
}));

import { GitHubCopilotProvider } from "../../llm/github-copilot";

describe("GitHubCopilotProvider.generateStream", () => {
  let provider: GitHubCopilotProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GitHubCopilotProvider("gpt-4o");

    // Mock for streaming
    mockCreate.mockImplementation((params: Record<string, unknown>) => {
      if (params.stream) {
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of mockStreamChunks) {
              yield chunk;
            }
          },
        };
      }
      return {
        choices: [{ message: { content: "non-streamed" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      };
    });
  });

  it("streams text chunks via openaiCompatGenerateStream", async () => {
    const chunks: string[] = [];
    const result = await provider.generateStream({ prompt: "Hello" }, (chunk) =>
      chunks.push(chunk),
    );

    expect(chunks).toEqual(["Streamed ", "output"]);
    expect(result.content).toBe("Streamed output");
  });

  it("returns usage from stream", async () => {
    const result = await provider.generateStream({ prompt: "Hello" }, () => {});

    expect(result.usage).toEqual({
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    });
  });
});
