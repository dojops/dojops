const MAX_SYSTEM_PROMPT_LENGTH = 32 * 1024; // 32KB

/** Confidence threshold above which unsafe prompts are blocked. */
const BLOCK_CONFIDENCE_THRESHOLD = 0.5;

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?previous/i,
  /ignore\s+(?:all\s+)?above/i,
  /disregard\s+(?:all\s+)?(?:previous|above|prior)/i,
  /discard\s+(?:all\s+)?(?:previous|above|prior)/i,
  /new\s+instructions?\s*:/i,
  /updated\s+(?:instructions?|rules?)\s*:/i,
  /new\s+persona\s*:/i,
  /\bsystem\s*:\s/i,
  /override\s+(?:all\s+)?(?:previous|prior|above)/i,
  /you\s+are\s+now\s+(?:a|an)\b/i,
  /pretend\s+(?:to\s+be|you\s+are)/i,
  /act\s+as\s+(?:if|though)\s+you/i,
  /forget\s+(?:all\s+)?(?:previous|prior|your)/i,
  /from\s+now\s+on\s+(?:you|ignore|disregard)/i,
  /\bdo\s+not\s+follow\s+(?:the|any|your)\s+(?:previous|above|prior)/i,
  /\bswitch\s+to\s+(?:a\s+)?(?:new|different)\s+(?:mode|persona|role)/i,
];

export interface PromptValidationResult {
  safe: boolean;
  /** Confidence score for injection detection (0-1). Higher = more suspicious. */
  confidence: number;
  /** Whether the prompt should be blocked (high-confidence injection detected). */
  block: boolean;
  warnings: string[];
}

/**
 * Validates system prompt content for injection patterns and length.
 * Returns actionable data: `safe` indicates no suspicious patterns found,
 * `block` is true when injection confidence exceeds the threshold (0.7),
 * allowing callers to reject the prompt.
 */
export function validateSystemPrompt(prompt: string): PromptValidationResult {
  const warnings: string[] = [];
  let matchCount = 0;

  if (prompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    warnings.push(
      `System prompt exceeds max length (${prompt.length} > ${MAX_SYSTEM_PROMPT_LENGTH})`,
    );
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(prompt)) {
      warnings.push(`Suspicious pattern detected: ${pattern.source}`);
      matchCount++;
    }
  }

  const safe = warnings.length === 0;
  // Confidence: each pattern match adds 0.35 (2 matches = 0.7, which exceeds 0.5 threshold)
  const confidence = safe ? 0 : Math.min(matchCount * 0.35, 1);
  const block = !safe && confidence >= BLOCK_CONFIDENCE_THRESHOLD;

  return { safe, confidence, block, warnings };
}
