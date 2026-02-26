import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMRequest, LLMResponse } from "./provider";
import { parseAndValidate } from "./json-validator";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-5-20250929") {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const system = req.schema
      ? `${req.system ?? ""}\n\nYou MUST respond with valid JSON only. No markdown, no extra text.`.trim()
      : req.system;

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
      if (usedPrefill && errMsg.includes("prefill")) {
        usedPrefill = false;
        const messagesWithoutPrefill = messages.filter(
          (m) => !(m.role === "assistant" && m.content === "{"),
        );
        message = await this.client.messages.create({
          model: this.model,
          max_tokens: req.maxTokens ?? 8192,
          system,
          messages: messagesWithoutPrefill,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        });
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
      }
      const parsed = parseAndValidate(content, req.schema);
      return { content, parsed };
    }

    return { content };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": this.client.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      });
      const data = await response.json();
      const models: string[] = ((data as { data?: Array<{ id: string }> }).data ?? [])
        .filter((m) => m.id.startsWith("claude-"))
        .map((m) => m.id);
      return models.sort();
    } catch {
      return [];
    }
  }
}

/** Extract a clean error message from Anthropic SDK errors. */
function extractApiError(err: unknown): string {
  if (err instanceof Error) {
    // Anthropic SDK embeds JSON like: "400 {"type":"error","error":{"type":"...","message":"..."}}"
    const jsonMatch = err.message.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const body = JSON.parse(jsonMatch[0]);
        const msg = body?.error?.message;
        if (typeof msg === "string") return msg;
      } catch {
        // fall through
      }
    }
    return err.message;
  }
  return String(err);
}
