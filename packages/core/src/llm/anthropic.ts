import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { LLMProvider, LLMRequest, LLMResponse } from "./provider";
import { parseAndValidate } from "./json-validator";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;
  private model: string;

  private apiKey: string;

  constructor(apiKey: string, model = "claude-sonnet-4-5-20250929") {
    this.apiKey = apiKey;
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

    if (req.schema) {
      messages.push({ role: "assistant", content: "{" });
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
      throw new Error(extractApiError(err), { cause: err });
    }

    let content = message.content[0].type === "text" ? message.content[0].text : "";

    if (req.schema) {
      if (message.stop_reason === "max_tokens") {
        throw new Error(
          "LLM response was truncated (hit max_tokens limit). The generated JSON is incomplete.",
        );
      }
      content = "{" + content;
      const parsed = parseAndValidate(content, req.schema);
      return { content, parsed };
    }

    return { content };
  }

  async listModels(): Promise<string[]> {
    const response = await axios.get("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    const models: string[] = (response.data.data ?? [])
      .filter((m: { id: string }) => m.id.startsWith("claude-"))
      .map((m: { id: string }) => m.id);
    return models.sort();
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
