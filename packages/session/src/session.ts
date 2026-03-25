import {
  LLMProvider,
  LLMResponse,
  AgentRouter,
  StreamCallback,
  SpecialistAgent,
  ChatMessage as CoreChatMessage,
} from "@dojops/core";
import { ChatMessage, ChatSessionState, SessionMode, ChatProgressCallbacks } from "./types";
import { MemoryManager } from "./memory";
import { SessionSummarizer } from "./summarizer";
import { generateSessionId } from "./serializer";
import { rewindMessages, getTurnCount } from "./rewind";
import type { RewindResult } from "./rewind";

export interface ChatSessionOptions {
  /** LLM provider — optional so chat can start without one (for /config, /init). */
  provider?: LLMProvider;
  /** Agent router — optional, required only when sending LLM messages. */
  router?: AgentRouter;
  state?: ChatSessionState;
  maxContextMessages?: number;
  mode?: SessionMode;
  /** Project domains from `dojops init` for context-biased routing. */
  projectDomains?: string[];
  /** Project context string injected as system message so LLM knows the project. */
  projectContext?: string;
}

export interface BridgeCommand {
  command: string;
  args: string;
}

export interface SendResult {
  content: string;
  agent: string;
  /** Per-turn token usage from the LLM provider (when available). */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** Total estimated tokens across all session messages. */
  sessionTokens: number;
}

/** Internal result from prepareRequest — the routed agent and LLM context. */
interface PreparedRequest {
  agent: SpecialistAgent;
  contextMessages: CoreChatMessage[];
}

export class ChatSession {
  private readonly state: ChatSessionState;
  private provider: LLMProvider | undefined;
  private router: AgentRouter | undefined;
  private readonly memoryManager: MemoryManager;
  private summarizer: SessionSummarizer | undefined;
  private readonly projectDomains: string[];
  private readonly projectContext?: string;

  constructor(opts: ChatSessionOptions) {
    this.provider = opts.provider;
    this.router = opts.router;
    this.memoryManager = new MemoryManager(opts.maxContextMessages ?? 20);
    this.summarizer = opts.provider ? new SessionSummarizer(opts.provider) : undefined;
    this.projectDomains = opts.projectDomains ?? [];
    this.projectContext = opts.projectContext;

    this.state = opts.state ?? {
      id: generateSessionId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode: opts.mode ?? "INTERACTIVE",
      messages: [],
      metadata: {
        totalTokensEstimate: 0,
        messageCount: 0,
      },
    };
  }

  get id(): string {
    return this.state.id;
  }

  get messages(): ChatMessage[] {
    return this.state.messages;
  }

  get mode(): SessionMode {
    return this.state.mode;
  }

  /** True when an LLM provider and router are available for sending messages. */
  hasProvider(): boolean {
    return !!this.provider && !!this.router;
  }

  /**
   * SA-12: Shared logic for send() and sendStream().
   * Pushes user message, runs summarization if needed, routes to agent,
   * and builds context messages for the LLM call.
   */
  private async prepareRequest(
    userMessage: string,
    progress?: ChatProgressCallbacks,
  ): Promise<PreparedRequest> {
    if (!this.provider || !this.router) {
      throw new Error(
        "No LLM provider configured. Use /config to set up a provider, then /provider to activate it.",
      );
    }

    // Add user message to history
    const userMsg: ChatMessage = {
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    this.state.messages.push(userMsg);

    // Check if summarization is needed — wrapped in try/catch so a
    // summarization failure never loses the user message already pushed above.
    if (
      this.summarizer &&
      this.state.mode === "INTERACTIVE" &&
      this.memoryManager.needsSummarization(this.state.messages.length)
    ) {
      progress?.onPhase?.("compacting");
      try {
        const keepCount = this.memoryManager.windowSize;
        const totalBefore = this.state.messages.length;
        const oldMessages = this.state.messages.slice(0, totalBefore - keepCount);
        this.state.summary = await this.summarizer.summarize(oldMessages);
        // Trim old messages after successful summarization to prevent memory leak
        this.state.messages = this.state.messages.slice(-keepCount);
        progress?.onCompaction?.({
          messagesSummarized: totalBefore - keepCount,
          messagesRetained: keepCount,
        });
      } catch (err) {
        console.warn(
          "Session summarization failed, continuing without summary:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Route to agent: try keyword routing first, only use LLM when confidence is low
    progress?.onPhase?.("routing");
    const agentName = this.state.pinnedAgent;
    const agents = this.router.getAgents();
    let agent = agentName ? agents.find((a) => a.name === agentName) : undefined;

    if (!agent) {
      const keywordRoute = this.router.route(userMessage, {
        projectDomains: this.projectDomains,
      });
      if (keywordRoute.confidence >= 0.4) {
        agent = keywordRoute.agent;
      } else {
        const llmRoute = await this.router.routeWithLLM(userMessage, {
          projectDomains: this.projectDomains,
        });
        agent = llmRoute.agent;
      }
    }

    progress?.onPhase?.("generating", agent.name);

    // Build context messages for LLM
    const contextMessages = this.memoryManager.getContextMessages(
      this.state.messages,
      this.state.summary,
      this.projectContext,
    );

    return { agent, contextMessages };
  }

  /**
   * Record the assistant response and update session metadata.
   * Shared post-processing for both send() and sendStream().
   */
  private finalize(
    response: LLMResponse,
    agentName: string,
    progress?: ChatProgressCallbacks,
  ): void {
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: response.content,
      timestamp: new Date().toISOString(),
    };
    this.state.messages.push(assistantMsg);

    this.state.metadata.messageCount = this.state.messages.length;
    this.state.metadata.totalTokensEstimate = this.memoryManager.estimateTokens(
      this.state.messages,
    );
    this.state.metadata.lastAgentUsed = agentName;
    this.state.updatedAt = new Date().toISOString();

    progress?.onPhase?.("done");

    // Warn when session approaches typical context limit (85% of 128K tokens)
    const TOKEN_LIMIT_THRESHOLD = 108_000; // ~85% of 128K
    if (this.state.metadata.totalTokensEstimate > TOKEN_LIMIT_THRESHOLD) {
      console.warn(
        `Session approaching token limit: ~${this.state.metadata.totalTokensEstimate} tokens`,
      );
    }
  }

  async send(userMessage: string, progress?: ChatProgressCallbacks): Promise<SendResult> {
    // Check for bridge command
    const bridge = this.isBridgeCommand(userMessage);
    if (bridge) {
      return {
        content: `__bridge__:${bridge.command}:${bridge.args}`,
        agent: "bridge",
        sessionTokens: this.state.metadata.totalTokensEstimate,
      };
    }

    const { agent, contextMessages } = await this.prepareRequest(userMessage, progress);

    // Call LLM with history — on failure, roll back user message to keep session clean
    let response;
    try {
      response = await agent.runWithHistory(contextMessages);
    } catch (err) {
      this.state.messages.pop();
      throw err;
    }

    this.finalize(response, agent.name, progress);

    return {
      content: response.content,
      agent: agent.name,
      usage: response.usage,
      sessionTokens: this.state.metadata.totalTokensEstimate,
    };
  }

  /**
   * Send a message with streaming — calls onChunk with each text delta.
   * Falls back to non-streaming send() if the agent doesn't support it.
   */
  async sendStream(
    userMessage: string,
    onChunk: StreamCallback,
    progress?: ChatProgressCallbacks,
  ): Promise<SendResult> {
    // Bridge commands don't stream
    const bridge = this.isBridgeCommand(userMessage);
    if (bridge) {
      const content = `__bridge__:${bridge.command}:${bridge.args}`;
      onChunk(content);
      return { content, agent: "bridge", sessionTokens: this.state.metadata.totalTokensEstimate };
    }

    const { agent, contextMessages } = await this.prepareRequest(userMessage, progress);

    // Stream response — on failure, roll back user message
    let response;
    try {
      response = await agent.streamWithHistory(contextMessages, onChunk);
    } catch (err) {
      this.state.messages.pop();
      throw err;
    }

    this.finalize(response, agent.name, progress);

    return {
      content: response.content,
      agent: agent.name,
      usage: response.usage,
      sessionTokens: this.state.metadata.totalTokensEstimate,
    };
  }

  setName(name: string): void {
    this.state.name = name;
  }

  pinAgent(agentName: string): void {
    if (!this.router) {
      throw new Error("No LLM provider configured. Set up a provider with /config first.");
    }
    // UX #4: Validate agent name against available agents
    const agents = this.router.getAgents();
    const match = agents.find((a) => a.name === agentName || a.name.startsWith(agentName));
    if (!match) {
      const available = agents.map((a) => a.name).join(", ");
      throw new Error(`Unknown agent: "${agentName}". Available: ${available}`);
    }
    this.state.pinnedAgent = match.name;
  }

  unpinAgent(): void {
    this.state.pinnedAgent = undefined;
  }

  /**
   * Swap the LLM provider mid-session — message history is preserved since it
   * uses a provider-agnostic format. The summarizer is also replaced so future
   * compaction uses the new provider.
   */
  setProvider(provider: LLMProvider): void {
    this.provider = provider;
    this.summarizer = new SessionSummarizer(provider);
  }

  /** Swap the agent router mid-session (needed when the underlying provider changes). */
  setRouter(router: AgentRouter): void {
    this.router = router;
    // Unpin agent — old agent reference may not exist in new router
    this.state.pinnedAgent = undefined;
  }

  /**
   * Manually compress conversation by summarizing older messages.
   * Keeps the most recent messages and replaces the rest with a summary.
   */
  async compress(): Promise<{ messagesSummarized: number; messagesRetained: number } | null> {
    if (!this.summarizer) {
      throw new Error("No LLM provider configured. Use /config to set up a provider first.");
    }
    if (this.state.messages.length < 4) return null;

    const keepCount = Math.min(4, this.state.messages.length);
    const totalBefore = this.state.messages.length;
    const oldMessages = this.state.messages.slice(0, totalBefore - keepCount);

    this.state.summary = await this.summarizer.summarize(oldMessages);
    this.state.messages = this.state.messages.slice(-keepCount);
    this.state.metadata.messageCount = this.state.messages.length;
    this.state.metadata.totalTokensEstimate = this.memoryManager.estimateTokens(
      this.state.messages,
    );
    this.state.updatedAt = new Date().toISOString();

    return {
      messagesSummarized: totalBefore - keepCount,
      messagesRetained: keepCount,
    };
  }

  /**
   * Rewind the last n conversation turns (user+assistant pairs).
   * Returns details about what was removed.
   */
  rewind(n = 1): RewindResult {
    const result = rewindMessages(this.state.messages, n);
    this.state.metadata.messageCount = this.state.messages.length;
    this.state.metadata.totalTokensEstimate = this.memoryManager.estimateTokens(
      this.state.messages,
    );
    this.state.updatedAt = new Date().toISOString();
    return result;
  }

  /** Return the number of user turns in this session. */
  turnCount(): number {
    return getTurnCount(this.state.messages);
  }

  clearMessages(): void {
    this.state.messages = [];
    this.state.summary = undefined;
    this.state.metadata.messageCount = 0;
    this.state.metadata.totalTokensEstimate = 0;
    this.state.updatedAt = new Date().toISOString();
  }

  getState(): ChatSessionState {
    return { ...this.state, messages: this.state.messages.map((m) => ({ ...m })) };
  }

  isBridgeCommand(msg: string): BridgeCommand | null {
    const trimmed = msg.trim();
    if (trimmed.startsWith("/plan ")) {
      return { command: "plan", args: trimmed.slice(6).trim() };
    }
    if (trimmed === "/apply") {
      return { command: "apply", args: "" };
    }
    if (trimmed === "/scan" || trimmed.startsWith("/scan ")) {
      return { command: "scan", args: trimmed.slice(5).trim() };
    }
    return null;
  }
}
