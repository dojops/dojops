import { GoogleGenAI } from "@google/genai";
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage, getRequestTimeoutMs } from "./provider";
import type { LLMToolRequest, LLMToolResponse, ToolCall } from "./tool-types";
import { buildLLMResponse, extractApiError } from "./openai-compat";
import { augmentSystemPrompt } from "./schema-prompt";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(apiKey: string, model = "gemini-2.5-flash") {
    this.client = new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: getRequestTimeoutMs() },
    });
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const systemPrompt = augmentSystemPrompt(req.system, req.schema) || undefined;

    const contents = req.messages?.length
      ? req.messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? ("model" as const) : ("user" as const),
            parts: [{ text: m.content }],
          }))
      : [{ role: "user" as const, parts: [{ text: req.prompt }] }];

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          ...(req.schema ? { responseMimeType: "application/json" } : {}),
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        },
      });
    } catch (err: unknown) {
      throw new Error(extractApiError(err), { cause: err });
    }

    const content = response.text ?? "";

    // Check for truncation or safety blocks
    const candidates = (response as unknown as { candidates?: Array<{ finishReason?: string }> })
      .candidates;
    const finishReason = candidates?.[0]?.finishReason;
    if (req.schema && finishReason === "MAX_TOKENS") {
      throw new Error(
        "LLM response was truncated (hit max tokens limit). The generated JSON is incomplete.",
      );
    }
    if (finishReason === "SAFETY") {
      throw new Error("LLM response was blocked by safety filters.");
    }

    const usageMeta = (
      response as unknown as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }
    ).usageMetadata;
    const usage: LLMUsage | undefined = usageMeta
      ? {
          promptTokens: usageMeta.promptTokenCount ?? 0,
          completionTokens: usageMeta.candidatesTokenCount ?? 0,
          totalTokens: usageMeta.totalTokenCount ?? 0,
        }
      : undefined;

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

    // Map AgentMessages to Gemini contents format
    const contents = [];
    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        contents.push({
          role: "function" as const,
          parts: [{ functionResponse: { name: "tool", response: { result: m.content } } }],
        });
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        const parts: Array<Record<string, unknown>> = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
        contents.push({ role: "model" as const, parts });
      } else {
        contents.push({
          role: m.role === "assistant" ? ("model" as const) : ("user" as const),
          parts: [{ text: m.content }],
        });
      }
    }

    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents,
        tools,
        config: {
          systemInstruction: req.system || undefined,
          ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
        },
      } as Parameters<typeof this.client.models.generateContent>[0]);
    } catch (err: unknown) {
      throw new Error(extractApiError(err), { cause: err });
    }

    // Extract text and function calls from response
    let content = "";
    const toolCalls: ToolCall[] = [];
    const candidates = (
      response as unknown as {
        candidates?: Array<{
          content?: { parts?: Array<Record<string, unknown>> };
          finishReason?: string;
        }>;
      }
    ).candidates;
    const parts = candidates?.[0]?.content?.parts ?? [];
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

    const finishReason = candidates?.[0]?.finishReason;
    const stopReason: LLMToolResponse["stopReason"] =
      toolCalls.length > 0 ? "tool_use" : finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn";

    const usageMeta = (
      response as unknown as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      }
    ).usageMetadata;
    const usage = usageMeta
      ? {
          promptTokens: usageMeta.promptTokenCount ?? 0,
          completionTokens: usageMeta.candidatesTokenCount ?? 0,
          totalTokens: usageMeta.totalTokenCount ?? 0,
        }
      : undefined;

    return { content, toolCalls, stopReason, usage };
  }

  async listModels(): Promise<string[]> {
    try {
      const pager = await this.client.models.list();
      const models: string[] = [];
      for (const model of pager.page) {
        if (model.name?.startsWith("models/gemini-")) {
          models.push(model.name.replace("models/", ""));
        }
      }
      return models.sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }
}
