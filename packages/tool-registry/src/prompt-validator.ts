const MAX_SYSTEM_PROMPT_LENGTH = 32 * 1024; // 32KB

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /ignore\s+(?:all\s+)?above/i,
  /disregard\s+(?:all\s+)?(?:previous|above|prior)/i,
  /new\s+instructions?\s*:/i,
  /\bsystem\s*:\s/i,
  /override\s+(?:all\s+)?(?:previous|prior|above)/i,
  /you\s+are\s+now\s+(?:a|an)\b/i,
  /pretend\s+(?:to\s+be|you\s+are)/i,
  /act\s+as\s+(?:if|though)\s+you/i,
  /forget\s+(?:all\s+)?(?:previous|prior|your)/i,
];

export interface PromptValidationResult {
  safe: boolean;
  warnings: string[];
}

/**
 * Validates system prompt content for injection patterns and length.
 * Warns on suspicious content but does not block (defense in depth).
 */
export function validateSystemPrompt(prompt: string): PromptValidationResult {
  const warnings: string[] = [];

  if (prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    warnings.push(
      `System prompt exceeds max length (${prompt.length} > ${MAX_SYSTEM_PROMPT_LENGTH})`,
    );
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      warnings.push(`Suspicious pattern detected: ${pattern.source}`);
    }
  }

  return { safe: warnings.length === 0, warnings };
}
