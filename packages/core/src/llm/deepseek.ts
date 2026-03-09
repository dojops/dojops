import OpenAI from "openai";
import { LLMProvider, LLMRequest, LLMResponse, getRequestTimeoutMs } from "./provider";
import { openaiCompatGenerate, openaiCompatListModels } from "./openai-compat";

export class DeepSeekProvider implements LLMProvider {
  name = "deepseek";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model = "deepseek-chat") {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.deepseek.com/v1",
      timeout: getRequestTimeoutMs(),
    });
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    return openaiCompatGenerate(this.client, this.model, "DeepSeek", req);
  }

  async listModels(): Promise<string[]> {
    return openaiCompatListModels(this.client);
  }
}
