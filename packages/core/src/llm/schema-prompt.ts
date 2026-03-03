import { z } from "zod";

/**
 * Augment a system prompt with the JSON Schema description of the expected output.
 *
 * Providers that don't support native schema enforcement (OpenAI, DeepSeek,
 * Anthropic, Gemini, GitHub Copilot) use this to embed the required output
 * structure in the system prompt so the LLM knows exactly what fields to produce.
 *
 * Ollama handles this natively via its `format` parameter and does not need this.
 */
export function augmentSystemPrompt(
  system: string | undefined,
  schema: z.ZodType | undefined,
): string {
  if (!schema) return system ?? "";

  const jsonSchema = z.toJSONSchema(schema);
  const schemaStr = JSON.stringify(jsonSchema, null, 2);

  const schemaInstruction = [
    "",
    "You MUST respond with valid JSON only. No markdown, no extra text.",
    "",
    "Your response MUST conform to this exact JSON Schema:",
    "```json",
    schemaStr,
    "```",
    "",
    "Ensure ALL required fields are present and match the specified types.",
  ].join("\n");

  return ((system ?? "") + schemaInstruction).trim();
}
