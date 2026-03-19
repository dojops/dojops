import { ChatMessage } from "./types";
import { ChatMessage as CoreChatMessage } from "@dojops/core";

export class MemoryManager {
  constructor(private readonly maxMessages: number = 20) {}

  /** The configured message window size for context and summarization. */
  get windowSize(): number {
    return this.maxMessages;
  }

  getContextMessages(
    allMessages: ChatMessage[],
    summary?: string,
    projectContext?: string,
  ): CoreChatMessage[] {
    const result: CoreChatMessage[] = [];

    // Chat-mode override: the specialist system prompt says "single-shot interaction"
    // but in chat we ARE multi-turn, so override that instruction.
    result.push({
      role: "system",
      content:
        "This is a multi-turn chat session — the user CAN reply and ask follow-up questions. " +
        "When the user asks you to analyze, review, or check project files, use the actual file " +
        "contents provided in the project context below to give specific, actionable feedback. " +
        "Do NOT output generic task lists or plans — instead, directly analyze the files and " +
        "provide concrete findings with file paths, line references, and specific fixes.",
    });

    // Inject project context so LLM knows about the actual project structure
    if (projectContext) {
      result.push({
        role: "system",
        content: `Current project information:\n${projectContext}`,
      });
    }

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
