import { ZodTypeAny } from "zod";

export class JsonValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JsonValidationError";
  }
}

function stripMarkdownFences(text: string): string {
  // Match triple backticks or triple tildes (with optional language tag)
  const fenced = text.match(/(?:```|~~~)(?:json)?\s*\n?([\s\S]*?)\n?\s*(?:```|~~~)/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export function parseAndValidate<T>(raw: string, schema: ZodTypeAny): T {
  const cleaned = stripMarkdownFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new JsonValidationError("Failed to parse JSON from LLM response", raw);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new JsonValidationError(
      `Schema validation failed: ${result.error.message}`,
      raw,
      result.error,
    );
  }

  return result.data as T;
}
