import OpenAI from "openai";
import { LLMRequest, LLMResponse, LLMUsage } from "./provider";
import { parseAndValidate } from "./json-validator";
import { redactSecrets } from "./redact";
import { augmentSystemPrompt } from "./schema-prompt";

/** Build final LLM response, parsing structured output if schema was requested. */
export function buildLLMResponse(
  content: string,
  usage: LLMUsage | undefined,
  req: LLMRequest,
): LLMResponse {
  if (req.schema) {
    const parsed = parseAndValidate(content, req.schema);
    return { content, parsed, usage };
  }
  return { content, usage };
}

/** Shared generate logic for OpenAI-compatible providers (OpenAI, DeepSeek). */
export async function openaiCompatGenerate(
  client: OpenAI,
  model: string,
  providerName: string,
  req: LLMRequest,
): Promise<LLMResponse> {
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
    completion = await client.chat.completions.create({
      model,
      messages,
      ...(req.schema ? { response_format: { type: "json_object" } } : {}),
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    });
  } catch (err: unknown) {
    throw new Error(extractApiError(err), { cause: err });
  }

  const choice = completion.choices[0];
  if (!choice) {
    throw new Error(`${providerName} returned empty choices array (model: ${model})`);
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

  return buildLLMResponse(content, usage, req);
}

/** Extract a readable error message from an LLM provider SDK error. */
export function extractApiError(err: unknown): string {
  if (err instanceof Error) {
    const jsonMatch = /\{[\s\S]*?\}/.exec(err.message);
    if (jsonMatch) {
      try {
        const body = JSON.parse(jsonMatch[0]);
        const msg = body?.error?.message ?? body?.message;
        if (typeof msg === "string") return redactSecrets(msg);
      } catch {
        // fall through
      }
    }
    return redactSecrets(err.message);
  }
  return redactSecrets(String(err));
}

/** Shared listModels helper. */
export async function openaiCompatListModels(
  client: OpenAI,
  filter?: (id: string) => boolean,
): Promise<string[]> {
  try {
    const list = await client.models.list();
    const models: string[] = [];
    for await (const model of list) {
      if (!filter || filter(model.id)) {
        models.push(model.id);
      }
    }
    return models.sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}
