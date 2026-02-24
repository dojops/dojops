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
  private state: ChatSessionState;
  private provider: LLMProvider;
  private router: AgentRouter;
  private memoryManager: MemoryManager;
  private summarizer: SessionSummarizer;

  constructor(opts: ChatSessionOptions) {
    this.provider = opts.provider;
    this.router = opts.router;
    this.memoryManager = new MemoryManager(opts.maxContextMessages ?? 20);
    this.summarizer = new SessionSummarizer(opts.provider);

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

    // Check if summarization is needed
    if (
      this.state.mode === "INTERACTIVE" &&
      this.memoryManager.needsSummarization(this.state.messages.length)
    ) {
      const oldMessages = this.state.messages.slice(
        0,
        this.state.messages.length - this.memoryManager["maxMessages"],
      );
      this.state.summary = await this.summarizer.summarize(oldMessages);
    }

    // Route to agent
    const agentName = this.state.pinnedAgent;
    const agents = this.router.getAgents();
    let agent = agentName ? agents.find((a) => a.name === agentName) : undefined;

    if (!agent) {
      const route = this.router.route(userMessage);
      agent = route.agent;
    }

    // Build context messages for LLM
    const contextMessages = this.memoryManager.getContextMessages(
      this.state.messages,
      this.state.summary,
    );

    // Call LLM with history
    const response = await agent.runWithHistory(contextMessages);

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

    return { content: response.content, agent: agent.name };
  }

  pinAgent(agentName: string): void {
    this.state.pinnedAgent = agentName;
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
    return { ...this.state };
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
