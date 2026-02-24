import { ChatMessage } from "./types";
import { ChatMessage as CoreChatMessage } from "@dojops/core";

export class MemoryManager {
  constructor(private maxMessages: number = 20) {}

  getContextMessages(allMessages: ChatMessage[], summary?: string): CoreChatMessage[] {
    const result: CoreChatMessage[] = [];

    if (summary) {
      result.push({
        role: "system",
        content: `Previous conversation summary:\n${summary}`,
      });
    }

    const window = allMessages.slice(-this.maxMessages);
    for (const msg of window) {
      result.push({ role: msg.role, content: msg.content });
    }

    return result;
  }

  needsSummarization(messageCount: number): boolean {
    return messageCount > Math.floor(this.maxMessages * 1.5);
  }

  estimateTokens(messages: ChatMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length;
    }
    return Math.ceil(totalChars / 4);
  }
}
