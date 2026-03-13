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
  openaiCompatListModels,
} from "./openai-compat";

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

  async generateStream(req: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse> {
    return openaiCompatGenerateStream(this.client, this.model, "DeepSeek", req, onChunk);
  }

  async listModels(): Promise<string[]> {
    return openaiCompatListModels(this.client);
  }
}
