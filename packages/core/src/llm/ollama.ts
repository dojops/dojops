import https from "node:https";
import axios from "axios";
import { z } from "zod";
import { LLMProvider, LLMRequest, LLMResponse, LLMUsage, getRequestTimeoutMs } from "./provider";
import type { LLMToolRequest, LLMToolResponse } from "./tool-types";
import { buildLLMResponse } from "./openai-compat";
import { augmentSystemPrompt } from "./schema-prompt";
import { buildToolCallingSystemPrompt, parseToolCallsFromContent } from "./prompt-tool-calling";

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
    const config: Record<string, unknown> = { timeout: getRequestTimeoutMs("OLLAMA_TIMEOUT") };
    if (this.tlsRejectUnauthorized === false) {
      config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
    return config;
  }

  async generate(req: LLMRequest): Promise<LLMResponse> {
    // Ollama enforces JSON structure natively via `format` — but schemas with
    // Zod transforms (.default(), .transform()) can't be converted to JSON Schema.
    // Fall back to system prompt augmentation when conversion fails.
    let format: Record<string, unknown> | undefined;
    if (req.schema) {
      try {
        format = z.toJSONSchema(req.schema) as Record<string, unknown>;
      } catch {
        // Schema has transforms — fall back to prompt-based schema injection
      }
    }
    const system =
      (format ? (req.system ?? "") : augmentSystemPrompt(req.system, req.schema)) || undefined;

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
      throw this.wrapError(err);
    }

    return buildLLMResponse(content, usage, req);
  }

  private wrapError(err: unknown): Error {
    if (!axios.isAxiosError(err)) throw err;
    if (err.response?.status === 404) {
      return new Error(
        `Model "${this.model}" not found on Ollama. Run: ollama pull ${this.model}`,
        { cause: err },
      );
    }
    if (err.code === "ECONNREFUSED") {
      return new Error(
        `Cannot connect to Ollama at ${this.baseUrl}. Is the Ollama server running?`,
        { cause: err },
      );
    }
    if (err.code === "ECONNABORTED") {
      const timeoutSec = getRequestTimeoutMs("OLLAMA_TIMEOUT") / 1000;
      return new Error(
        `Ollama request timed out after ${timeoutSec}s. Set DOJOPS_REQUEST_TIMEOUT=${timeoutSec * 2} (seconds) to increase.`,
        { cause: err },
      );
    }
    return new Error(`Ollama request failed: ${err.message}`, { cause: err });
  }

  async generateWithTools(req: LLMToolRequest): Promise<LLMToolResponse> {
    // Ollama's native tool-calling varies by model — use prompt-based fallback
    const augmentedSystem = buildToolCallingSystemPrompt(req.system ?? "", req.tools);

    // Convert AgentMessages to Ollama chat format
    const chatMessages: Array<{ role: string; content: string }> = [
      { role: "system", content: augmentedSystem },
    ];

    for (const m of req.messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        chatMessages.push({ role: "user", content: `Tool result (${m.callId}): ${m.content}` });
      } else if (m.role === "assistant" && m.toolCalls?.length) {
        // Reconstruct the JSON format the LLM previously produced
        const callsJson = JSON.stringify({
          tool_calls: m.toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments })),
        });
        chatMessages.push({ role: "assistant", content: callsJson });
      } else {
        chatMessages.push({ role: m.role, content: m.content });
      }
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/chat`,
        {
          model: this.model,
          messages: chatMessages,
          stream: false,
          ...(req.temperature === undefined ? {} : { options: { temperature: req.temperature } }),
          keep_alive: this.keepAlive,
        },
        this.getAxiosConfig(),
      );

      const content = response.data?.message?.content ?? "";
      const usage = extractUsage(response.data);
      const result = parseToolCallsFromContent(content);
      result.usage = usage;
      return result;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, this.getAxiosConfig());
      const models: string[] = (response.data.models ?? []).map((m: { name: string }) => m.name);
      return models.sort((a, b) => a.localeCompare(b));
    } catch (err) {
      if (axios.isAxiosError(err) && err.code === "ECONNREFUSED") {
        console.error(
          `[dojops] Cannot connect to Ollama at ${this.baseUrl}. Is the Ollama server running?`,
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dojops] Failed to list Ollama models: ${msg}`);
      }
      return [];
    }
  }
}
