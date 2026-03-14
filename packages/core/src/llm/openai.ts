import OpenAI from "openai";
import {
  LLMProvider,
  LLMRequest,
  LLMResponse,
  StreamCallback,
  getRequestTimeoutMs,
} from "./provider";
import {
  openaiCompatGenerate,
  openaiCompatGenerateStream,
  openaiCompatGenerateWithTools,
  openaiCompatListModels,
} from "./openai-compat";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey, timeout: getRequestTimeoutMs() });
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    return openaiCompatGenerate(this.client, this.model, "OpenAI", req);
  }

  async generateStream(req: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    return openaiCompatGenerateStream(this.client, this.model, "OpenAI", req, onChunk);
  }

  async generateWithTools(req: LLMToolRequest): Promise<LLMToolResponse> {
    return openaiCompatGenerateWithTools(this.client, this.model, "OpenAI", req);
  }

  async listModels(): Promise<string[]> {
    return openaiCompatListModels(this.client, (id) => id.startsWith("gpt-"));
  }
}
