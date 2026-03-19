import { ChatMessage, LLMProvider, LLMRequest, LLMResponse, StreamCallback } from "../llm/provider";
import { sanitizeUserInput } from "../llm/sanitizer";
import { validateRequestSize } from "../llm/input-validator";
import { ToolDependency } from "./tool-deps";

/** Maximum content length for a single message (128KB). */
const MAX_MESSAGE_LENGTH = 128 * 1024;
/** Default timeout for LLM calls in milliseconds. */
const DEFAULT_TIMEOUT_MS = 120_000;

export interface SpecialistConfig {
  name: string;
  domain: string;
  description?: string;
  systemPrompt: string;
  keywords: string[];
  /** High-signal keywords that get a confidence boost when matched. */
  primaryKeywords?: string[];
  toolDependencies?: ToolDependency[];
}

/** Check whether an error is transient (network/5xx) and worth retrying. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // Network errors
  if (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  )
    return true;
  // HTTP 5xx / 429
  if (/\b(5\d{2}|429)\b/.test(msg)) return true;
  return false;
}

export class SpecialistAgent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly config: SpecialistConfig,
    private readonly docAugmenter?: {
      augmentPrompt(s: string, kw: string[], q: string): Promise<string>;
    },
  ) {}

  get name(): string {
    return this.config.name;
  }

  get domain(): string {
    return this.config.domain;
  }

  get description(): string | undefined {
    return this.config.description;
  }

  get keywords(): string[] {
    return this.config.keywords;
  }

  get primaryKeywords(): string[] {
    return this.config.primaryKeywords ?? [];
  }

  get systemPrompt(): string {
    return this.config.systemPrompt;
  }

  get toolDependencies(): ToolDependency[] {
    return this.config.toolDependencies ?? [];
  }

  async run(
    request: Omit<LLMRequest, "system">,
    opts?: { timeoutMs?: number },
  ): Promise<LLMResponse> {
    let systemPrompt = this.config.systemPrompt;
    if (this.docAugmenter) {
      try {
        const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
        systemPrompt = await this.docAugmenter.augmentPrompt(
          systemPrompt,
          keywords,
          request.prompt,
        );
      } catch {
        // Graceful degradation: proceed without docs
      }
    }

    const fullRequest = {
      ...request,
      prompt: sanitizeUserInput(request.prompt),
      system: systemPrompt,
    };

    const validation = validateRequestSize(fullRequest);
    if (validation.warning) {
      console.warn(`[${this.config.name}] ${validation.warning}`);
    }

    return this.executeWithRetry(() => this.provider.generate(fullRequest), opts?.timeoutMs);
  }

  async runWithHistory(
    messages: ChatMessage[],
    opts?: Omit<LLMRequest, "system" | "prompt" | "messages"> & { timeoutMs?: number },
  ): Promise<LLMResponse> {
    const sanitizedMessages = messages
      .filter((m) => m.content.length <= MAX_MESSAGE_LENGTH)
      .map((m) => ({
        ...m,
        content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
      }));

    // Providers strip system messages from the messages array — merge them
    // into the system prompt so project context, chat-mode instructions, and
    // conversation summaries actually reach the LLM.
    const contextSystemMsgs = sanitizedMessages.filter((m) => m.role === "system");
    const nonSystemMessages = sanitizedMessages.filter((m) => m.role !== "system");

    let systemPrompt = this.config.systemPrompt;
    if (contextSystemMsgs.length > 0) {
      const contextBlock = contextSystemMsgs.map((m) => m.content).join("\n\n");
      systemPrompt = `${systemPrompt}\n\n${contextBlock}`;
    }

    if (this.docAugmenter && nonSystemMessages.length > 0) {
      try {
        const lastUserMsg = [...nonSystemMessages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
          systemPrompt = await this.docAugmenter.augmentPrompt(
            systemPrompt,
            keywords,
            lastUserMsg.content,
          );
        }
      } catch {
        // Graceful degradation: proceed without docs
      }
    }

    const { timeoutMs, ...llmOpts } = opts ?? {};
    return this.executeWithRetry(
      () =>
        this.provider.generate({
          ...llmOpts,
          prompt: "",
          messages: nonSystemMessages,
          system: systemPrompt,
        }),
      timeoutMs,
    );
  }

  /** Whether the underlying provider supports streaming. */
  get supportsStreaming(): boolean {
    return typeof this.provider.generateStream === "function";
  }

  /**
   * Stream a response with full chat history. Falls back to non-streaming if
   * the provider does not implement generateStream.
   */
  async streamWithHistory(
    messages: ChatMessage[],
    onChunk: StreamCallback,
    opts?: Omit<LLMRequest, "system" | "prompt" | "messages"> & { timeoutMs?: number },
  ): Promise<LLMResponse> {
    if (!this.provider.generateStream) {
      // Fallback: run non-streaming, emit full content as one chunk
      const result = await this.runWithHistory(messages, opts);
      onChunk(result.content);
      return result;
    }

    const sanitizedMessages = messages
      .filter((m) => m.content.length <= MAX_MESSAGE_LENGTH)
      .map((m) => ({
        ...m,
        content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
      }));

    // Merge system messages into the system prompt (providers strip them from messages)
    const contextSystemMsgs = sanitizedMessages.filter((m) => m.role === "system");
    const nonSystemMessages = sanitizedMessages.filter((m) => m.role !== "system");

    let systemPrompt = this.config.systemPrompt;
    if (contextSystemMsgs.length > 0) {
      const contextBlock = contextSystemMsgs.map((m) => m.content).join("\n\n");
      systemPrompt = `${systemPrompt}\n\n${contextBlock}`;
    }

    if (this.docAugmenter && nonSystemMessages.length > 0) {
      try {
        const lastUserMsg = [...nonSystemMessages].reverse().find((m) => m.role === "user");
        if (lastUserMsg) {
          const keywords = [this.config.domain, ...this.config.keywords.slice(0, 3)];
          systemPrompt = await this.docAugmenter.augmentPrompt(
            systemPrompt,
            keywords,
            lastUserMsg.content,
          );
        }
      } catch {
        // Graceful degradation: proceed without docs
      }
    }

    const { timeoutMs, ...llmOpts } = opts ?? {};
    const request: LLMRequest = {
      ...llmOpts,
      prompt: "",
      messages: nonSystemMessages,
      system: systemPrompt,
    };

    return this.executeWithRetry(() => this.provider.generateStream!(request, onChunk), timeoutMs);
  }

  /** Execute an LLM call with timeout and a single retry on transient errors. */
  private async executeWithRetry(
    fn: () => Promise<LLMResponse>,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<LLMResponse> {
    const callWithTimeout = (): Promise<LLMResponse> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Agent ${this.config.name} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      return Promise.race([fn(), timeoutPromise]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
    };

    try {
      return await callWithTimeout();
    } catch (err) {
      if (isTransientError(err)) {
        // Single retry after brief delay
        await new Promise((r) => setTimeout(r, 1000));
        return callWithTimeout();
      }
      throw err;
    }
  }
}
