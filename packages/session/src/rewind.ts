import type { ChatMessage } from "./types";

export interface RewindResult {
  removedTurns: number;
  removedMessages: ChatMessage[];
}

/**
 * Messages come in user/assistant pairs. Remove the last n pairs by walking
 * backwards through the messages array and removing toRemove user+assistant groups.
 */
export function rewindMessages(messages: ChatMessage[], n: number): RewindResult {
  const turnCount = messages.filter((m) => m.role === "user").length;
  const toRemove = Math.min(n, turnCount);
  let removed = 0;
  const removedMsgs: ChatMessage[] = [];

  while (removed < toRemove && messages.length > 0) {
    const msg = messages.pop()!;
    removedMsgs.unshift(msg);
    if (msg.role === "user") removed++;
  }

  return { removedTurns: removed, removedMessages: removedMsgs };
}

export function getTurnCount(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}
