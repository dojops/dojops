import { LLMProvider } from "@dojops/core";
import { ChatMessage } from "./types";

export class SessionSummarizer {
  constructor(private readonly provider: LLMProvider) {}

  async summarize(messages: ChatMessage[]): Promise<string> {
    if (messages.length === 0) return "";

    const conversationText = messages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");

    const response = await this.provider.generate({
      system:
        "You are a conversation summarizer. Summarize the following DevOps conversation concisely " +
        "in 2-3 paragraphs. Focus on key decisions, context established, tools/technologies discussed, " +
        "and any action items. This summary will be used as context for continuing the conversation.",
      prompt: conversationText,
    });

    return response.content;
  }
}
