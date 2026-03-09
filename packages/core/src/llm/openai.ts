import OpenAI from "openai";
import { LLMProvider, LLMRequest, LLMResponse, getRequestTimeoutMs } from "./provider";
import { openaiCompatGenerate, openaiCompatListModels } from "./openai-compat";

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

  async listModels(): Promise<string[]> {
    return openaiCompatListModels(this.client, (id) => id.startsWith("gpt-"));
  }
}
