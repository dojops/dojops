import OpenAI from "openai";
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage } from "./provider";
import { parseAndValidate } from "./json-validator";
import { redactSecrets } from "./redact";
import { getValidCopilotToken } from "./copilot-auth";
import { augmentSystemPrompt } from "./schema-prompt";

const COPILOT_HEADERS: Record<string, string> = {
  "editor-version": "vscode/1.95.0",
  "editor-plugin-version": "copilot/1.250.0",
  "user-agent": "GithubCopilot/1.250.0",
  "Copilot-Integration-Id": "vscode-chat",
};

// Well-known Copilot models — used as fallback when /models endpoint returns empty
const KNOWN_COPILOT_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4",
  "gpt-3.5-turbo",
  "claude-3.5-sonnet",
  "o1-mini",
  "o1-preview",
];

export class GitHubCopilotProvider implements LLMProvider {
  name = "github-copilot";
  private readonly model: string;

  constructor(model = "gpt-4o") {
    this.model = model;
  }

  private async getClient(): Promise<OpenAI> {
    const { token, apiBaseUrl } = await getValidCopilotToken();
    return new OpenAI({
      apiKey: token,
      baseURL: apiBaseUrl,
      defaultHeaders: COPILOT_HEADERS,
    });
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const systemContent = augmentSystemPrompt(req.system, req.schema);

    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = req.messages
      ?.length
      ? [
          { role: "system" as const, content: systemContent },
          ...req.messages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
        ]
      : [
          { role: "system" as const, content: systemContent },
          { role: "user" as const, content: req.prompt },
        ];

    let completion: OpenAI.Chat.ChatCompletion;
    try {
      const client = await this.getClient();
      completion = await client.chat.completions.create({
        model: this.model,
        messages,
        ...(req.schema ? { response_format: { type: "json_object" } } : {}),
        ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      });
    } catch (err: unknown) {
      throw new Error(extractApiError(err), { cause: err });
    }

    const choice = completion.choices[0];
    if (!choice) {
      throw new Error(`GitHub Copilot returned empty choices array (model: ${this.model})`);
    }

    if (req.schema && choice.finish_reason === "length") {
      throw new Error("LLM response truncated (finish_reason=length); output may be incomplete");
    }

    const content = choice.message.content ?? "";

    const usage: LLMUsage | undefined = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined;

    if (req.schema) {
      const parsed = parseAndValidate(content, req.schema);
      return { content, parsed, usage };
    }

    return { content, usage };
  }

  async listModels(): Promise<string[]> {
    try {
      const client = await this.getClient();
      const list = await client.models.list();
      const models: string[] = [];
      for await (const model of list) {
        models.push(model.id);
      }
      return models.length > 0 ? models.sort((a, b) => a.localeCompare(b)) : KNOWN_COPILOT_MODELS;
    } catch {
      return KNOWN_COPILOT_MODELS;
    }
  }
}

function extractApiError(err: unknown): string {
  if (err instanceof Error) {
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
