export type SessionMode = "INTERACTIVE" | "DETERMINISTIC";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ChatSessionState {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  mode: SessionMode;
  messages: ChatMessage[];
  summary?: string;
  pinnedAgent?: string;
  metadata: {
    totalTokensEstimate: number;
    messageCount: number;
    lastAgentUsed?: string;
  };
}

/** Phases of chat message processing, reported via progress callbacks. */
export type ChatPhase = "routing" | "compacting" | "generating" | "done";

/** Information about a conversation compaction event. */
export interface CompactionInfo {
  messagesSummarized: number;
  messagesRetained: number;
}

/** Optional callbacks for observing chat processing phases. */
export interface ChatProgressCallbacks {
  onPhase?: (phase: ChatPhase, detail?: string) => void;
  onCompaction?: (info: CompactionInfo) => void;
  /** Fired when the LLM streams extended thinking content. */
  onThinking?: (text: string) => void;
  /** Fired when token usage increments during streaming (approximate). */
  onTokenDelta?: (count: number) => void;
}
