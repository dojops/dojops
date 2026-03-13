import { z } from "zod";

/**
 * Returns the request timeout in milliseconds.
 * Priority: provider-specific env > DOJOPS_REQUEST_TIMEOUT env > defaultMs
 * Env values are in seconds for user convenience.
 */
export function getRequestTimeoutMs(providerEnvVar?: string, defaultMs = 300_000): number {
  // Check provider-specific env first (e.g. OLLAMA_TIMEOUT)
  if (providerEnvVar) {
    const specific = process.env[providerEnvVar];
    if (specific !== undefined) {
      const parsed = Number(specific);
      if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
    }
  }
  // Check generic DOJOPS_REQUEST_TIMEOUT
  const generic = process.env.DOJOPS_REQUEST_TIMEOUT;
  if (generic !== undefined) {
    const parsed = Number(generic);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
  }
  return defaultMs;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ThinkingLevel = "none" | "low" | "medium" | "high";

export interface LLMRequest {
  system?: string;
  prompt: string;
  messages?: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  schema?: z.ZodType;
  /** Reasoning effort level. Maps to provider-specific features (e.g. Anthropic extended thinking). */
  thinking?: ThinkingLevel;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse<T = unknown> {
  content: string;
  parsed?: T;
  usage?: LLMUsage;
}

/** Callback invoked with each text chunk during streaming generation. */
export type StreamCallback = (chunk: string) => void;

export interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  /** Stream generation — calls onChunk with each text delta. Returns full response when done. */
  generateStream?(request: LLMRequest, onChunk: StreamCallback): Promise<LLMResponse>;
  listModels?(): Promise<string[]>;
}
