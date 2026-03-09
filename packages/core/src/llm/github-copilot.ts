import OpenAI from "openai";
import { LLMProvider, LLMRequest, LLMResponse, getRequestTimeoutMs } from "./provider";
import { getValidCopilotToken } from "./copilot-auth";
import { openaiCompatGenerate, openaiCompatListModels } from "./openai-compat";

const COPILOT_HEADERS: Record<string, string> = {
  "editor-version": "vscode/1.95.0",
  "editor-plugin-version": "copilot/1.250.0",
  "user-agent": "GithubCopilot/1.250.0",
  "Copilot-Integration-Id": "vscode-chat",
};

// Well-known Copilot models — used as fallback when /models endpoint returns empty
const KNOWN_COPILOT_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4",
  "gpt-3.5-turbo",
  "claude-3.5-sonnet",
  "o1-mini",
  "o1-preview",
];

export class GitHubCopilotProvider implements LLMProvider {
  name = "github-copilot";
  private readonly model: string;

  constructor(model = "gpt-4o") {
    this.model = model;
  }

  private async getClient(): Promise<OpenAI> {
    const { token, apiBaseUrl } = await getValidCopilotToken();
    return new OpenAI({
      apiKey: token,
      baseURL: apiBaseUrl,
      defaultHeaders: COPILOT_HEADERS,
      timeout: getRequestTimeoutMs(),
    });
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const client = await this.getClient();
    return openaiCompatGenerate(client, this.model, "GitHub Copilot", req);
  }

  async listModels(): Promise<string[]> {
    try {
      const client = await this.getClient();
      const models = await openaiCompatListModels(client);
      return models.length > 0 ? models : KNOWN_COPILOT_MODELS;
    } catch {
      return KNOWN_COPILOT_MODELS;
    }
  }
}
