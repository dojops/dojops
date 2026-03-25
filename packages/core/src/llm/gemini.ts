/**
 * Gemini LLM provider using native fetch against the Gemini REST API.
 * No SDK dependency — avoids the @google/genai → google-auth-library → gaxios →
 * node-fetch → node-domexception chain that triggers npm deprecation warnings.
 */
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage, getRequestTimeoutMs } from "./provider";
import type { AgentMessage, LLMToolRequest, LLMToolResponse, ToolCall } from "./tool-types";
import { buildLLMResponse } from "./openai-compat";
import { augmentSystemPrompt } from "./schema-prompt";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Shape of a Gemini generateContent response body. */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<Record<string, unknown>> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

/** Shape of a Gemini list-models response body. */
interface GeminiListModelsResponse {
  models?: Array<{ name?: string }>;
}

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model = "gemini-2.5-flash") {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = getRequestTimeoutMs();
  }

  private async callApi(model: string, body: Record<string, unknown>): Promise<GeminiResponse> {
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Gemini API error ${res.status}: ${errBody}`);
      }
      return (await res.json()) as GeminiResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const systemPrompt = augmentSystemPrompt(req.system, req.schema) || undefined;

    const contents = req.messages?.length
      ? req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          }))
      : [{ role: "user", parts: [{ text: req.prompt }] }];

    const generationConfig: Record<string, unknown> = {};
    if (req.schema) generationConfig.responseMimeType = "application/json";
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;

    const body: Record<string, unknown> = { contents, generationConfig };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    let response: GeminiResponse;
    try {
      response = await this.callApi(this.model, body);
    } catch (err: unknown) {
      throw new Error((err as Error).message, { cause: err });
    }

    const content = extractText(response);
    const finishReason = response.candidates?.[0]?.finishReason;

    if (req.schema && finishReason === "MAX_TOKENS") {
      throw new Error(
        "LLM response was truncated (hit max tokens limit). The generated JSON is incomplete.",
      );
    }
    if (finishReason === "SAFETY") {
      throw new Error("LLM response was blocked by safety filters.");
    }

    const usage = extractUsage(response);
    return buildLLMResponse(content, usage, req);
  }

  async generateWithTools(req: LLMToolRequest): Promise<LLMToolResponse> {
    const tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];

    const contents = mapToGeminiContents(req.messages);

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;

    const body: Record<string, unknown> = { contents, tools, generationConfig };
    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }

    let response: GeminiResponse;
    try {
      response = await this.callApi(this.model, body);
    } catch (err: unknown) {
      throw new Error((err as Error).message, { cause: err });
    }

    const { content, toolCalls } = extractToolResponse(response);
    const finishReason = response.candidates?.[0]?.finishReason;
    const stopReason = mapStopReason(toolCalls, finishReason);
    const usage = extractUsage(response);

    return { content, toolCalls, stopReason, usage };
  }

  async listModels(): Promise<string[]> {
    try {
      const url = `${GEMINI_API_BASE}/models?key=${this.apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return [];
        const data = (await res.json()) as GeminiListModelsResponse;
        const models: string[] = [];
        for (const m of data.models ?? []) {
          if (m.name?.startsWith("models/gemini-")) {
            models.push(m.name.replace("models/", ""));
          }
        }
        return models.sort((a, b) => a.localeCompare(b));
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return [];
    }
  }
}

// ── Response helpers ─────────────────────────────────────────────

function extractText(response: GeminiResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");
}

function extractUsage(response: GeminiResponse): LLMUsage | undefined {
  const u = response.usageMetadata;
  if (!u) return undefined;
  return {
    promptTokens: u.promptTokenCount ?? 0,
    completionTokens: u.candidatesTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

function extractToolResponse(response: GeminiResponse): {
  content: string;
  toolCalls: ToolCall[];
} {
  let content = "";
  const toolCalls: ToolCall[] = [];
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  let callIdCounter = 0;

  for (const part of parts) {
    if (part.text && typeof part.text === "string") {
      content += part.text;
    }
    if (part.functionCall && typeof part.functionCall === "object") {
      const fc = part.functionCall as { name: string; args?: Record<string, unknown> };
      toolCalls.push({
        id: `gemini-call-${callIdCounter++}`,
        name: fc.name,
        arguments: fc.args ?? {},
      });
    }
  }

  return { content, toolCalls };
}

function mapStopReason(
  toolCalls: ToolCall[],
  finishReason: string | undefined,
): LLMToolResponse["stopReason"] {
  if (toolCalls.length > 0) return "tool_use";
  if (finishReason === "MAX_TOKENS") return "max_tokens";
  return "end_turn";
}

// ── Content mapping ──────────────────────────────────────────────

function mapToGeminiContents(
  messages: AgentMessage[],
): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    contents.push(mapSingleContent(m));
  }
  return contents;
}

function mapSingleContent(m: AgentMessage): {
  role: string;
  parts: Array<Record<string, unknown>>;
} {
  if (m.role === "tool") {
    return {
      role: "function",
      parts: [{ functionResponse: { name: "tool", response: { result: m.content } } }],
    };
  }

  if (m.role === "assistant" && m.toolCalls?.length) {
    const parts: Array<Record<string, unknown>> = [];
    if (m.content) parts.push({ text: m.content });
    for (const tc of m.toolCalls) {
      parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
    }
    return { role: "model", parts };
  }

  const role = m.role === "assistant" ? "model" : "user";
  return { role, parts: [{ text: m.content }] };
}
