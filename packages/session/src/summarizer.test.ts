import { describe, it, expect, vi } from "vitest";
import { SessionSummarizer } from "./summarizer";
import { LLMProvider } from "@dojops/core";
import { ChatMessage } from "./types";

function createMockProvider(response: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({ content: response }),
  };
}

describe("SessionSummarizer", () => {
  it("calls LLM with summarization prompt", async () => {
    const provider = createMockProvider("Summary of the conversation.");
    const summarizer = new SessionSummarizer(provider);

    const messages: ChatMessage[] = [
      { role: "user", content: "Create a Terraform config", timestamp: "2024-01-01T00:00:00Z" },
      {
        role: "assistant",
        content: "Here is a Terraform config for S3",
        timestamp: "2024-01-01T00:00:01Z",
      },
    ];

    const result = await summarizer.summarize(messages);
    expect(result).toBe("Summary of the conversation.");
    expect(provider.generate).toHaveBeenCalledOnce();
    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toContain("summarizer");
    expect(call.prompt).toContain("Terraform");
  });

  it("returns empty string for empty message list", async () => {
    const provider = createMockProvider("Should not be called");
    const summarizer = new SessionSummarizer(provider);
    const result = await summarizer.summarize([]);
    expect(result).toBe("");
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
