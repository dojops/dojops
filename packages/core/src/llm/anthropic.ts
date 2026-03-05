import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage } from "./provider";
import { parseAndValidate } from "./json-validator";
import { redactSecrets } from "./redact";
import { augmentSystemPrompt } from "./schema-prompt";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-5-20250929") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const system = augmentSystemPrompt(req.system, req.schema) || undefined;

    const messages: Anthropic.MessageParam[] = req.messages?.length
      ? [
          ...req.messages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
        ]
      : [{ role: "user" as const, content: req.prompt }];

    let usedPrefill = false;
    if (req.schema) {
      messages.push({ role: "assistant", content: "{" });
      usedPrefill = true;
    }

    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 8192,
        system,
        messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });
    } catch (err: unknown) {
      const errMsg = extractApiError(err);
      // Some models don't support assistant prefill — retry without it
      if (usedPrefill && /\bprefill\b/i.test(errMsg)) {
        usedPrefill = false;
        const messagesWithoutPrefill = messages.filter(
          (m) => m.role !== "assistant" || m.content !== "{",
        );
        try {
          message = await this.client.messages.create({
            model: this.model,
            max_tokens: req.maxTokens ?? 8192,
            system,
            messages: messagesWithoutPrefill,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          });
        } catch (retryErr: unknown) {
          throw new Error(extractApiError(retryErr), { cause: retryErr });
        }
      } else {
        throw new Error(errMsg, { cause: err });
      }
    }

    const firstBlock = message.content[0];
    let content = firstBlock?.type === "text" ? firstBlock.text : "";

    const usage: LLMUsage | undefined = message.usage
      ? {
          promptTokens: message.usage.input_tokens,
          completionTokens: message.usage.output_tokens,
          totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        }
      : undefined;

    if (req.schema) {
      if (message.stop_reason === "max_tokens") {
        throw new Error(
          "LLM response was truncated (hit max_tokens limit). The generated JSON is incomplete.",
        );
      }
      if (usedPrefill) {
        content = "{" + content;
      }
      const parsed = parseAndValidate(content, req.schema);
      return { content, parsed, usage };
    }

    return { content, usage };
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

/** Extract a clean error message from Anthropic SDK errors. */
function extractApiError(err: unknown): string {
  if (err instanceof Error) {
    // Anthropic SDK embeds JSON like: "400 {"type":"error","error":{"type":"...","message":"..."}}"
    const jsonMatch = /\{[\s\S]*\}/.exec(err.message);
    if (jsonMatch) {
      try {
        const body = JSON.parse(jsonMatch[0]);
        const msg = body?.error?.message;
        if (typeof msg === "string") return redactSecrets(msg);
      } catch {
        // fall through
      }
    }
    return redactSecrets(err.message);
  }
  return redactSecrets(String(err));
}
