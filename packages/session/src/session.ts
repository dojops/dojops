import { LLMProvider, AgentRouter } from "@dojops/core";
import { ChatMessage, ChatSessionState, SessionMode } from "./types";
import { MemoryManager } from "./memory";
import { SessionSummarizer } from "./summarizer";
import { generateSessionId } from "./serializer";

export interface ChatSessionOptions {
  provider: LLMProvider;
  router: AgentRouter;
  state?: ChatSessionState;
  maxContextMessages?: number;
  mode?: SessionMode;
  /** Project domains from `dojops init` for context-biased routing. */
  projectDomains?: string[];
}

export interface BridgeCommand {
  command: string;
  args: string;
}

export interface SendResult {
  content: string;
  agent: string;
}

export class ChatSession {
  private readonly state: ChatSessionState;
  private readonly provider: LLMProvider;
  private readonly router: AgentRouter;
  private readonly memoryManager: MemoryManager;
  private readonly summarizer: SessionSummarizer;
  private readonly projectDomains: string[];

  constructor(opts: ChatSessionOptions) {
    this.provider = opts.provider;
    this.router = opts.router;
    this.memoryManager = new MemoryManager(opts.maxContextMessages ?? 20);
    this.summarizer = new SessionSummarizer(opts.provider);
    this.projectDomains = opts.projectDomains ?? [];

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

  async send(userMessage: string): Promise<SendResult> {
    // Check for bridge command
    const bridge = this.isBridgeCommand(userMessage);
    if (bridge) {
      return {
        content: `__bridge__:${bridge.command}:${bridge.args}`,
        agent: "bridge",
      };
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
      this.state.mode === "INTERACTIVE" &&
      this.memoryManager.needsSummarization(this.state.messages.length)
    ) {
      try {
        const keepCount = this.memoryManager["maxMessages"] as number;
        const oldMessages = this.state.messages.slice(0, this.state.messages.length - keepCount);
        this.state.summary = await this.summarizer.summarize(oldMessages);
        // Trim old messages after successful summarization to prevent memory leak
        this.state.messages = this.state.messages.slice(-keepCount);
      } catch (err) {
        console.warn(
          "Session summarization failed, continuing without summary:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Route to agent
    const agentName = this.state.pinnedAgent;
    const agents = this.router.getAgents();
    let agent = agentName ? agents.find((a) => a.name === agentName) : undefined;

    if (!agent) {
      const route = this.router.route(userMessage, { projectDomains: this.projectDomains });
      agent = route.agent;
    }

    // Build context messages for LLM
    const contextMessages = this.memoryManager.getContextMessages(
      this.state.messages,
      this.state.summary,
    );

    // UX #5: Call LLM with history — on failure, roll back user message to keep session clean
    let response;
    try {
      response = await agent.runWithHistory(contextMessages);
    } catch (err) {
      // Remove the user message we just pushed so session state stays clean
      this.state.messages.pop();
      throw err;
    }

    // Add assistant response to history
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: response.content,
      timestamp: new Date().toISOString(),
    };
    this.state.messages.push(assistantMsg);

    // Update metadata
    this.state.metadata.messageCount = this.state.messages.length;
    this.state.metadata.totalTokensEstimate = this.memoryManager.estimateTokens(
      this.state.messages,
    );
    this.state.metadata.lastAgentUsed = agent.name;
    this.state.updatedAt = new Date().toISOString();

    // Warn when session approaches typical context limit (85% of 128K tokens)
    const TOKEN_LIMIT_THRESHOLD = 108_000; // ~85% of 128K
    if (this.state.metadata.totalTokensEstimate > TOKEN_LIMIT_THRESHOLD) {
      console.warn(
        `Session approaching token limit: ~${this.state.metadata.totalTokensEstimate} tokens`,
      );
    }

    return { content: response.content, agent: agent.name };
  }

  setName(name: string): void {
    this.state.name = name;
  }

  pinAgent(agentName: string): void {
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
