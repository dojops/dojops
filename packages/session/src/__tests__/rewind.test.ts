import { describe, it, expect } from "vitest";
import { rewindMessages, getTurnCount } from "../rewind";
import type { ChatMessage } from "../types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: new Date().toISOString() };
}

describe("rewindMessages", () => {
  it("removes last turn (user+assistant pair)", () => {
    const messages: ChatMessage[] = [
      msg("user", "Hello"),
      msg("assistant", "Hi there"),
      msg("user", "How are you?"),
      msg("assistant", "I'm good"),
    ];

    const result = rewindMessages(messages, 1);

    expect(result.removedTurns).toBe(1);
    expect(result.removedMessages).toHaveLength(2);
    expect(result.removedMessages[0].role).toBe("user");
    expect(result.removedMessages[0].content).toBe("How are you?");
    expect(result.removedMessages[1].role).toBe("assistant");
    expect(result.removedMessages[1].content).toBe("I'm good");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].content).toBe("Hi there");
  });

  it("removes multiple turns", () => {
    const messages: ChatMessage[] = [
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
      msg("user", "m3"),
      msg("assistant", "r3"),
    ];

    const result = rewindMessages(messages, 2);

    expect(result.removedTurns).toBe(2);
    expect(result.removedMessages).toHaveLength(4);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("m1");
    expect(messages[1].content).toBe("r1");
  });

  it("handles n > total turns gracefully", () => {
    const messages: ChatMessage[] = [
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
    ];

    const result = rewindMessages(messages, 10);

    expect(result.removedTurns).toBe(2);
    expect(result.removedMessages).toHaveLength(4);
    expect(messages).toHaveLength(0);
  });

  it("returns removed messages in original order", () => {
    const messages: ChatMessage[] = [
      msg("user", "first"),
      msg("assistant", "reply-first"),
      msg("user", "second"),
      msg("assistant", "reply-second"),
    ];

    const result = rewindMessages(messages, 1);

    expect(result.removedMessages[0].content).toBe("second");
    expect(result.removedMessages[1].content).toBe("reply-second");
  });

  it("handles empty messages array", () => {
    const messages: ChatMessage[] = [];

    const result = rewindMessages(messages, 1);

    expect(result.removedTurns).toBe(0);
    expect(result.removedMessages).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it("handles n=0 (no removal)", () => {
    const messages: ChatMessage[] = [msg("user", "m1"), msg("assistant", "r1")];

    const result = rewindMessages(messages, 0);

    expect(result.removedTurns).toBe(0);
    expect(result.removedMessages).toHaveLength(0);
    expect(messages).toHaveLength(2);
  });

  it("handles system messages correctly", () => {
    const messages: ChatMessage[] = [
      msg("system", "You are helpful"),
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
    ];

    const result = rewindMessages(messages, 1);

    // Removes last user+assistant pair by popping from end
    expect(result.removedTurns).toBe(1);
    expect(result.removedMessages).toHaveLength(2);
    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toBe("m1");
  });
});

describe("getTurnCount", () => {
  it("counts user messages correctly", () => {
    const messages: ChatMessage[] = [
      msg("user", "m1"),
      msg("assistant", "r1"),
      msg("user", "m2"),
      msg("assistant", "r2"),
      msg("user", "m3"),
      msg("assistant", "r3"),
    ];

    expect(getTurnCount(messages)).toBe(3);
  });

  it("returns 0 for empty array", () => {
    expect(getTurnCount([])).toBe(0);
  });

  it("ignores system messages", () => {
    const messages: ChatMessage[] = [
      msg("system", "context"),
      msg("user", "hello"),
      msg("assistant", "hi"),
    ];

    expect(getTurnCount(messages)).toBe(1);
  });

  it("counts correctly when no user messages", () => {
    const messages: ChatMessage[] = [msg("system", "context"), msg("assistant", "unsolicited")];

    expect(getTurnCount(messages)).toBe(0);
  });
});
