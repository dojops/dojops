import { LLMRequest } from "./provider";

export interface InputValidationResult {
  valid: boolean;
  warning?: string;
}

/**
 * Estimates token count from text content using a hybrid heuristic.
 * Uses word-based counting (BPE averages ~1.4 tokens/word) for normal text,
 * with a character-based floor (chars/4) for content without whitespace
 * (minified code, encoded data, long identifiers).
 */
function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean);
  const wordEstimate = Math.ceil(words.length * 1.4);
  // Character-based floor catches long strings with few/no spaces
  const charEstimate = Math.ceil(text.length / 4);
  return Math.max(wordEstimate, charEstimate);
}

/**
 * Validates that an LLM request's input size is within acceptable bounds.
 * Estimates tokens from system prompt + user prompt character counts.
 *
 * @param req - The LLM request to validate
 * @param maxTokens - Maximum estimated token limit (default: 100,000)
 * @returns Validation result with optional warning message
 */
export function validateRequestSize(
  req: LLMRequest,
  maxTokens: number = 100_000,
): InputValidationResult {
  const parts: string[] = [];

  if (req.system) {
    parts.push(req.system);
  }

  parts.push(req.prompt);

  if (req.messages) {
    for (const msg of req.messages) {
      parts.push(msg.content);
    }
  }

  const estimatedTokens = estimateTokensFromText(parts.join(" "));

  if (estimatedTokens > maxTokens) {
    return {
      valid: false,
      warning: `Input exceeds estimated token limit (${estimatedTokens.toLocaleString()} estimated vs ${maxTokens.toLocaleString()} max). Consider reducing the input size.`,
    };
  }

  if (estimatedTokens > maxTokens * 0.8) {
    return {
      valid: true,
      warning: `Input approaching token limit (${estimatedTokens.toLocaleString()} estimated, ${maxTokens.toLocaleString()} max). Consider reducing the input size if issues occur.`,
    };
  }

  return { valid: true };
}
