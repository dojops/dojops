import Anthropic from "@anthropic-ai/sdk";
import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMUsage,
  StreamCallback,
  getRequestTimeoutMs,
} from "./provider";
import type { AgentMessage, LLMToolRequest, LLMToolResponse, ToolCall } from "./tool-types";
import { buildLLMResponse, extractApiError } from "./openai-compat";
import { augmentSystemPrompt } from "./schema-prompt";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-5-20250929") {
    this.client = new Anthropic({ apiKey, timeout: getRequestTimeoutMs() });
    this.model = model;
  }

  private buildMessages(req: LLMRequest): Anthropic.MessageParam[] {
    const messages: Anthropic.MessageParam[] = req.messages?.length
      ? req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : [{ role: "user" as const, content: req.prompt }];
    return messages;
  }

  private buildCreateParams(
    system: string | undefined,
    messages: Anthropic.MessageParam[],
    req: LLMRequest,
  ) {
    return {
      model: this.model,
      max_tokens: req.maxTokens ?? 8192,
      system,
      messages,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    };
  }

  private extractUsage(message: Anthropic.Message): LLMUsage | undefined {
    if (!message.usage) return undefined;
    return {
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
    };
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const system = augmentSystemPrompt(req.system, req.schema) || undefined;
    const messages = this.buildMessages(req);

    let usedPrefill = false;
    if (req.schema) {
      messages.push({ role: "assistant", content: "{" });
      usedPrefill = true;
    }

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create(this.buildCreateParams(system, messages, req));
    } catch (err: unknown) {
      const errMsg = extractApiError(err);
      if (usedPrefill && /\bprefill\b/i.test(errMsg)) {
        usedPrefill = false;
        const messagesWithoutPrefill = messages.filter(
          (m) => m.role !== "assistant" || m.content !== "{",
        );
        try {
          message = await this.client.messages.create(
            this.buildCreateParams(system, messagesWithoutPrefill, req),
          );
        } catch (retryErr: unknown) {
          throw new Error(extractApiError(retryErr), { cause: retryErr });
        }
      } else {
        throw new Error(errMsg, { cause: err });
      }
    }

    const firstBlock = message.content[0];
    let content = firstBlock?.type === "text" ? firstBlock.text : "";

    if (req.schema) {
      if (message.stop_reason === "max_tokens") {
        throw new Error(
          "LLM response was truncated (hit max_tokens limit). The generated JSON is incomplete.",
        );
      }
      if (usedPrefill) {
        content = "{" + content;
        // Guard against empty/whitespace-only model response producing invalid JSON
        const trimmed = content.trim();
        if (trimmed === "{" || trimmed === "") {
          throw new Error(
            "Anthropic returned empty content with prefill; cannot construct valid JSON",
          );
        }
      }
    }

    return buildLLMResponse(content, this.extractUsage(message), req);
  }

  async generateStream(req: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    // Structured output cannot stream reliably — fall back to non-streaming
    if (req.schema) {
      return this.generate(req);
    }

    const system = req.system || undefined;
    const messages = this.buildMessages(req);

    let stream: ReturnType<typeof this.client.messages.stream>;
    try {
      stream = this.client.messages.stream(this.buildCreateParams(system, messages, req));
    } catch (err: unknown) {
      throw new Error(extractApiError(err), { cause: err });
    }

    const chunks: string[] = [];
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        chunks.push(event.delta.text);
        onChunk(event.delta.text);
      }
    }

    const finalMessage = await stream.finalMessage();
    const content = chunks.join("");
    const usage = this.extractUsage(finalMessage);

    return { content, usage };
  }

  async generateWithTools(req: LLMToolRequest): Promise<LLMToolResponse> {
    const system = req.system || undefined;
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const messages = mapToAnthropicMessages(req.messages);

    // Extended thinking: map thinking level to budget_tokens
    const thinkingParam = buildThinkingParam(req.thinking, req.maxTokens ?? 8192);

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: thinkingParam ? thinkingParam.maxTokens : (req.maxTokens ?? 8192),
        system,
        messages,
        tools,
        ...(thinkingParam ? { thinking: thinkingParam.thinking } : {}),
        // temperature must be omitted when thinking is enabled (Anthropic requirement)
        ...(thinkingParam || req.temperature === undefined ? {} : { temperature: req.temperature }),
      });
    } catch (err: unknown) {
      throw new Error(extractApiError(err), { cause: err });
    }

    const { content, toolCalls, thinking } = extractAnthropicToolResponse(message);
    const stopReason = mapAnthropicStopReason(message.stop_reason);
    const usage = this.extractUsage(message);

    return { content, toolCalls, stopReason, usage, thinking: thinking || undefined };
  }

  async listModels(): Promise<string[]> {
    try {
      const page = await this.client.models.list({ limit: 100 });
      const models: string[] = page.data.filter((m) => m.id.startsWith("claude-")).map((m) => m.id);
      return models.sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }
}

/** Map thinking level to Anthropic extended thinking parameters. */
function buildThinkingParam(
  level: LLMToolRequest["thinking"],
  baseMaxTokens: number,
): { thinking: { type: "enabled"; budget_tokens: number }; maxTokens: number } | null {
  if (!level || level === "none") return null;
  // Budget tokens: low=2K, medium=8K, high=32K. Max tokens must be > budget.
  const budgetMap: Record<string, number> = { low: 2048, medium: 8192, high: 32768 };
  const budgetTokens = budgetMap[level] ?? 8192;
  // Anthropic requires max_tokens > budget_tokens
  const maxTokens = Math.max(baseMaxTokens, budgetTokens + 4096);
  return { thinking: { type: "enabled", budget_tokens: budgetTokens }, maxTokens };
}

/** Map AgentMessages to Anthropic message format. */
function mapToAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const mapped = mapSingleAnthropicMessage(m);
    if (mapped) result.push(mapped);
  }
  return result;
}

/** Map a single AgentMessage to an Anthropic MessageParam. */
function mapSingleAnthropicMessage(m: AgentMessage): Anthropic.MessageParam | null {
  if (m.role === "system") return null;

  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.callId,
          content: m.content,
          is_error: m.isError,
        },
      ],
    };
  }

  if (m.role === "assistant" && m.toolCalls?.length) {
    const content: Anthropic.ContentBlockParam[] = [];
    if (m.content) {
      content.push({ type: "text", text: m.content });
    }
    for (const tc of m.toolCalls) {
      content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
    }
    return { role: "assistant", content };
  }

  return { role: m.role, content: m.content };
}

/** Extract text, tool_use, and thinking blocks from an Anthropic message. */
function extractAnthropicToolResponse(message: Anthropic.Message): {
  content: string;
  toolCalls: ToolCall[];
  thinking: string;
} {
  let content = "";
  let thinking = "";
  const toolCalls: ToolCall[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      content += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      });
    } else if (block.type === "thinking") {
      thinking += (block as { type: "thinking"; thinking: string }).thinking;
    }
  }
  return { content, toolCalls, thinking };
}

/** Map Anthropic stop_reason to LLMToolResponse stopReason. */
function mapAnthropicStopReason(stopReason: string | null): LLMToolResponse["stopReason"] {
  if (stopReason === "tool_use") return "tool_use";
  if (stopReason === "max_tokens") return "max_tokens";
  return "end_turn";
}
