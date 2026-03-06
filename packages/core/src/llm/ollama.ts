import https from "node:https";
import axios from "axios";
import { z } from "zod";
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage } from "./provider";
import { buildLLMResponse } from "./openai-compat";
import { augmentSystemPrompt } from "./schema-prompt";

const OLLAMA_TIMEOUT_MS = 120_000;

function extractUsage(data: Record<string, unknown>): LLMUsage | undefined {
  const prompt = data?.prompt_eval_count;
  const completion = data?.eval_count;
  if (typeof prompt === "number" && typeof completion === "number") {
    return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
  }
  return undefined;
}

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private readonly model: string;

  constructor(
    private readonly baseUrl = "http://localhost:11434",
    model = "llama3",
    private readonly keepAlive: string = "5m",
    private readonly tlsRejectUnauthorized?: boolean,
  ) {
    this.model = model;
    // Validate URL and block SSRF targets
    try {
      const url = new URL(this.baseUrl);
      const hostname = url.hostname;
      // Block cloud metadata and link-local endpoints
      const blockedHosts = [
        "169.254.169.254",
        "metadata.google.internal",
        "100.100.100.200",
        "fd00::1",
      ];
      if (blockedHosts.includes(hostname)) {
        throw new Error(
          `SSRF protection: Ollama host "${hostname}" is a blocked metadata endpoint`,
        );
      }
      // Warn about plain HTTP to non-localhost endpoints
      if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname) && url.protocol === "http:") {
        console.error(
          "[WARN] Ollama connection uses plain HTTP to non-localhost endpoint. Consider using HTTPS.",
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("SSRF")) throw e;
      // invalid URL — will fail at request time
    }
  }

  private getAxiosConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = { timeout: OLLAMA_TIMEOUT_MS };
    if (this.tlsRejectUnauthorized === false) {
      config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
    return config;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const system = augmentSystemPrompt(req.system, req.schema) || undefined;

    const format = req.schema ? z.toJSONSchema(req.schema) : undefined;

    let content: string;
    let usage: LLMUsage | undefined;

    try {
      if (req.messages?.length) {
        const chatMessages = [
          { role: "system", content: system ?? "" },
          ...req.messages.filter((m) => m.role !== "system"),
        ];
        const response = await axios.post(
          `${this.baseUrl}/api/chat`,
          {
            model: this.model,
            messages: chatMessages,
            stream: false,
            ...(format ? { format } : {}),
            ...(req.temperature === undefined ? {} : { options: { temperature: req.temperature } }),
            keep_alive: this.keepAlive,
          },
          this.getAxiosConfig(),
        );
        content = response.data?.message?.content ?? "";
        usage = extractUsage(response.data);
      } else {
        const response = await axios.post(
          `${this.baseUrl}/api/generate`,
          {
            model: this.model,
            prompt: req.prompt,
            system,
            stream: false,
            ...(format ? { format } : {}),
            ...(req.temperature === undefined ? {} : { options: { temperature: req.temperature } }),
            keep_alive: this.keepAlive,
          },
          this.getAxiosConfig(),
        );
        content = response.data?.response ?? "";
        usage = extractUsage(response.data);
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          throw new Error(
            `Model "${this.model}" not found on Ollama. Run: ollama pull ${this.model}`,
            { cause: err },
          );
        }
        if (err.code === "ECONNREFUSED") {
          throw new Error(
            `Cannot connect to Ollama at ${this.baseUrl}. Is the Ollama server running?`,
            { cause: err },
          );
        }
        if (err.code === "ECONNABORTED") {
          throw new Error(`Ollama request timed out after ${OLLAMA_TIMEOUT_MS / 1000}s`, {
            cause: err,
          });
        }
        throw new Error(`Ollama request failed: ${err.message}`, { cause: err });
      }
      throw err;
    }

    return buildLLMResponse(content, usage, req);
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, this.getAxiosConfig());
      const models: string[] = (response.data.models ?? []).map((m: { name: string }) => m.name);
      return models.sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }
}
