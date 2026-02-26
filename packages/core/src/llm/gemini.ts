import { GoogleGenAI } from "@google/genai";
import { LLMProvider, LLMRequest, LLMResponse } from "./provider";
import { parseAndValidate } from "./json-validator";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model = "gemini-2.5-flash") {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const systemPrompt = req.schema
      ? `${req.system ?? ""}\n\nYou MUST respond with valid JSON only. No markdown, no extra text.`.trim()
      : req.system;

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
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
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

    if (req.schema) {
      const parsed = parseAndValidate(content, req.schema);
      return { content, parsed };
    }

    return { content };
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
      return models.sort();
    } catch {
      return [];
    }
  }
}

function extractApiError(err: unknown): string {
  if (err instanceof Error) {
    const jsonMatch = err.message.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const body = JSON.parse(jsonMatch[0]);
        const msg = body?.error?.message ?? body?.message;
        if (typeof msg === "string") return msg;
      } catch {
        // fall through
      }
    }
    return err.message;
  }
  return String(err);
}
