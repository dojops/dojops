import axios from "axios";
import { LLMProvider, LLMRequest, LLMResponse } from "./provider";
import { parseAndValidate } from "./json-validator";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private model: string;

  constructor(
    private baseUrl = "http://localhost:11434",
    model = "llama3",
  ) {
    this.model = model;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const system = req.schema
      ? `${req.system ?? ""}\n\nYou MUST respond with valid JSON only. No markdown, no extra text.`.trim()
      : req.system;

    let content: string;

    if (req.messages?.length) {
      const chatMessages = [
        { role: "system", content: system ?? "" },
        ...req.messages.filter((m) => m.role !== "system"),
      ];
      const response = await axios.post(`${this.baseUrl}/api/chat`, {
        model: this.model,
        messages: chatMessages,
        stream: false,
        ...(req.schema ? { format: "json" } : {}),
        ...(req.temperature !== undefined ? { options: { temperature: req.temperature } } : {}),
      });
      content = response.data.message.content;
    } else {
      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt: req.prompt,
        system,
        stream: false,
        ...(req.schema ? { format: "json" } : {}),
        ...(req.temperature !== undefined ? { options: { temperature: req.temperature } } : {}),
      });
      content = response.data.response;
    }

    if (req.schema) {
      const parsed = parseAndValidate(content, req.schema);
      return { content, parsed };
    }

    return { content };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`);
      const models: string[] = (response.data.models ?? []).map((m: { name: string }) => m.name);
      return models.sort();
    } catch {
      return [];
    }
  }
}
