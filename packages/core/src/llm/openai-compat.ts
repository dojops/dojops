import OpenAI from "openai";
import { LLMRequest, LLMResponse, LLMUsage, StreamCallback } from "./provider";
import type { LLMToolRequest, LLMToolResponse, ToolCall, AgentMessage } from "./tool-types";
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
    const jsonMatch = /\{[\s\S]*?\}/.exec(err.message); // NOSONAR - safe: non-greedy on bounded error message string
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

/** Shared streaming generate for OpenAI-compatible providers. */
export async function openaiCompatGenerateStream(
  client: OpenAI,
  model: string,
  providerName: string,
  req: LLMRequest,
  onChunk: StreamCallback,
): Promise<LLMResponse> {
  // Structured output (JSON mode) cannot stream reliably — fall back to non-streaming
  if (req.schema) {
    return openaiCompatGenerate(client, model, providerName, req);
  }

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

  let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    stream = await client.chat.completions.create({
      model,
      messages,
      stream: true,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    });
  } catch (err: unknown) {
    throw new Error(extractApiError(err), { cause: err });
  }

  const chunks: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      chunks.push(delta);
      onChunk(delta);
    }
    // Capture usage from the final chunk (OpenAI includes it with stream_options)
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens;
      completionTokens = chunk.usage.completion_tokens;
    }
  }

  const content = chunks.join("");
  const usage: LLMUsage | undefined =
    promptTokens > 0
      ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }
      : undefined;

  return { content, usage };
}

/** Map AgentMessage[] to OpenAI-compatible message format. */
function mapToOpenAIToolMessages(
  system: string | undefined,
  messages: AgentMessage[],
): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const m of messages) {
    if (m.role === "system") continue; // Already added above
    if (m.role === "tool") {
      result.push({ role: "tool", tool_call_id: m.callId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      result.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }

  return result;
}

/** Shared generateWithTools logic for OpenAI-compatible providers (OpenAI, DeepSeek, Copilot). */
export async function openaiCompatGenerateWithTools(
  client: OpenAI,
  model: string,
  providerName: string,
  req: LLMToolRequest,
): Promise<LLMToolResponse> {
  const messages = mapToOpenAIToolMessages(req.system, req.messages);

  const tools = req.tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await client.chat.completions.create({
      model,
      messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
      tools,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    });
  } catch (err: unknown) {
    throw new Error(extractApiError(err), { cause: err });
  }

  const choice = completion.choices[0];
  if (!choice) {
    throw new Error(`${providerName} returned empty choices array (model: ${model})`);
  }

  const content = choice.message.content ?? "";
  const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => {
    const fn = (tc as { id: string; function: { name: string; arguments: string } }).function;
    return {
      id: tc.id,
      name: fn.name,
      arguments: JSON.parse(fn.arguments || "{}") as Record<string, unknown>,
    };
  });

  const stopReason: LLMToolResponse["stopReason"] =
    choice.finish_reason === "tool_calls"
      ? "tool_use"
      : choice.finish_reason === "length"
        ? "max_tokens"
        : "end_turn";

  const usage = completion.usage
    ? {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      }
    : undefined;

  return { content, toolCalls, stopReason, usage };
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
