import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage, getRequestTimeoutMs } from "./provider";
import type { LLMToolRequest, LLMToolResponse, ToolCall } from "./tool-types";
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
      if (usedPrefill) content = "{" + content;
    }

    return buildLLMResponse(content, this.extractUsage(message), req);
  }

  async generateWithTools(req: LLMToolRequest): Promise<LLMToolResponse> {
    const system = req.system || undefined;
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    // Map AgentMessages to Anthropic format
    const messages: Anthropic.MessageParam[] = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        // Anthropic expects tool results as user messages with tool_result content blocks
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.callId,
              content: m.content,
              is_error: m.isError,
            },
          ],
        });
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        // Anthropic assistant messages contain tool_use blocks alongside text
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.content) {
          content.push({ type: "text", text: m.content });
        }
        for (const tc of m.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
        messages.push({ role: "assistant", content });
      } else {
        messages.push({ role: m.role as "user" | "assistant", content: m.content });
      }
    }

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 8192,
        system,
        messages,
        tools,
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      });
    } catch (err: unknown) {
      throw new Error(extractApiError(err), { cause: err });
    }

    // Extract text and tool_use blocks
    let content = "";
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
      }
    }

    const stopReason: LLMToolResponse["stopReason"] =
      message.stop_reason === "tool_use"
        ? "tool_use"
        : message.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";

    const usage = this.extractUsage(message);

    return { content, toolCalls, stopReason, usage };
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
