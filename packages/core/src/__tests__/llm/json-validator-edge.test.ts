import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseAndValidate, JsonValidationError } from "../../llm/json-validator";

const Simple = z.object({ name: z.string(), count: z.number() });

// ── Fence stripping edge cases ─────────────────────────────────────

describe("stripMarkdownFences — edge cases", () => {
  it("handles fence without language tag", () => {
    const raw = '```\n{"name": "no-lang", "count": 1}\n```';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "no-lang", count: 1 });
  });

  it("handles tilde fences without language tag", () => {
    const raw = '~~~\n{"name": "tilde", "count": 2}\n~~~';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "tilde", count: 2 });
  });

  it("extracts only the first fenced block when multiple exist", () => {
    const raw =
      '```json\n{"name": "first", "count": 1}\n```\n\n```json\n{"name": "second", "count": 2}\n```';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "first", count: 1 });
  });

  it("handles fence with extra whitespace before closing", () => {
    const raw = '```json\n{"name": "spaced", "count": 3}\n   ```';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "spaced", count: 3 });
  });

  it("handles unclosed fence — falls back to full text", () => {
    const raw = '```json\n{"name": "unclosed", "count": 4}';
    // No closing ``` → regex doesn't match → full text including ```json prefix
    expect(() => parseAndValidate(raw, Simple)).toThrow(JsonValidationError);
  });

  it("handles fence followed by extra text after closing", () => {
    const raw = '```json\n{"name": "extra", "count": 5}\n```\nSome trailing explanation text.';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "extra", count: 5 });
  });

  it("handles mismatched delimiters (backticks open, tildes close)", () => {
    // The regex accepts ``` or ~~~ at either end independently
    const raw = '```json\n{"name": "mixed", "count": 6}\n~~~';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "mixed", count: 6 });
  });

  it("handles empty content between fences", () => {
    const raw = "```json\n\n```";
    expect(() => parseAndValidate(raw, Simple)).toThrow(JsonValidationError);
  });

  it("handles JSON with newlines inside string values", () => {
    const raw = '```json\n{"name": "line1\\nline2", "count": 7}\n```';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "line1\nline2", count: 7 });
  });

  it("strips whitespace around raw JSON (no fences)", () => {
    const raw = '  \n  {"name": "trimmed", "count": 8}  \n  ';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "trimmed", count: 8 });
  });
});

// ── JSON parsing edge cases ────────────────────────────────────────

describe("parseAndValidate — JSON parsing edge cases", () => {
  it("handles empty string", () => {
    expect(() => parseAndValidate("", Simple)).toThrow(JsonValidationError);
  });

  it("handles whitespace-only string", () => {
    expect(() => parseAndValidate("   \n\t  ", Simple)).toThrow(JsonValidationError);
  });

  it("handles truncated JSON", () => {
    expect(() => parseAndValidate('{"name": "trunc', Simple)).toThrow(JsonValidationError);
  });

  it("handles JSON array when object expected", () => {
    expect(() => parseAndValidate("[1, 2, 3]", Simple)).toThrow("Schema validation failed");
  });

  it("handles JSON null", () => {
    expect(() => parseAndValidate("null", Simple)).toThrow("Schema validation failed");
  });

  it("handles JSON primitive (number)", () => {
    expect(() => parseAndValidate("42", Simple)).toThrow("Schema validation failed");
  });

  it("handles JSON primitive (string)", () => {
    expect(() => parseAndValidate('"just a string"', Simple)).toThrow("Schema validation failed");
  });

  it("handles valid JSON with extra fields (schema strips them)", () => {
    const raw = '{"name": "extra", "count": 9, "bonus": true}';
    const result = parseAndValidate(raw, Simple);
    expect(result).toEqual({ name: "extra", count: 9 });
  });

  it("handles deeply nested valid JSON", () => {
    const Nested = z.object({
      root: z.object({ child: z.object({ value: z.number() }) }),
    });
    const raw = '{"root": {"child": {"value": 42}}}';
    expect(parseAndValidate(raw, Nested)).toEqual({ root: { child: { value: 42 } } });
  });

  it("handles unicode in JSON values", () => {
    const raw = '{"name": "日本語テスト", "count": 10}';
    expect(parseAndValidate(raw, Simple)).toEqual({ name: "日本語テスト", count: 10 });
  });

  it("handles escaped quotes in JSON strings", () => {
    const raw = String.raw`{"name": "has \"quotes\"", "count": 11}`;
    expect(parseAndValidate(raw, Simple)).toEqual({ name: 'has "quotes"', count: 11 });
  });
});

// ── Schema validation edge cases ───────────────────────────────────

describe("parseAndValidate — schema validation edge cases", () => {
  it("rejects when required field is missing", () => {
    expect(() => parseAndValidate('{"name": "only"}', Simple)).toThrow("Schema validation failed");
  });

  it("rejects when field type is wrong", () => {
    expect(() => parseAndValidate('{"name": 123, "count": 1}', Simple)).toThrow(
      "Schema validation failed",
    );
  });

  it("applies Zod transforms", () => {
    const WithTransform = z.object({
      name: z.string().transform((s) => s.toUpperCase()),
      count: z.number(),
    });
    const result = parseAndValidate('{"name": "lower", "count": 1}', WithTransform);
    expect(result).toEqual({ name: "LOWER", count: 1 });
  });

  it("applies Zod defaults", () => {
    const WithDefault = z.object({
      name: z.string(),
      count: z.number().default(0),
    });
    const result = parseAndValidate('{"name": "default"}', WithDefault);
    expect(result).toEqual({ name: "default", count: 0 });
  });

  it("applies Zod optional", () => {
    const WithOptional = z.object({
      name: z.string(),
      count: z.number().optional(),
    });
    const result = parseAndValidate('{"name": "optional"}', WithOptional);
    expect(result).toEqual({ name: "optional" });
  });

  it("validates enum schema", () => {
    const EnumSchema = z.object({
      level: z.enum(["low", "medium", "high"]),
    });
    expect(parseAndValidate('{"level": "medium"}', EnumSchema)).toEqual({ level: "medium" });
    expect(() => parseAndValidate('{"level": "invalid"}', EnumSchema)).toThrow(
      "Schema validation failed",
    );
  });

  it("validates array schema", () => {
    const ArraySchema = z.object({
      items: z.array(z.string()).min(1),
    });
    expect(() => parseAndValidate('{"items": []}', ArraySchema)).toThrow(
      "Schema validation failed",
    );
    expect(parseAndValidate('{"items": ["a", "b"]}', ArraySchema)).toEqual({
      items: ["a", "b"],
    });
  });
});

// ── JsonValidationError properties ─────────────────────────────────

describe("JsonValidationError — error properties", () => {
  it("preserves raw string for JSON parse failures", () => {
    try {
      parseAndValidate("{broken}", Simple);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonValidationError);
      expect((e as JsonValidationError).raw).toBe("{broken}");
      expect((e as JsonValidationError).name).toBe("JsonValidationError");
    }
  });

  it("includes ZodError as cause for schema failures", () => {
    try {
      parseAndValidate('{"name": 42, "count": "wrong"}', Simple);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonValidationError);
      const err = e as JsonValidationError;
      expect(err.cause).toBeDefined();
      expect(err.message).toContain("Schema validation failed");
    }
  });

  it("has undefined cause for JSON parse failures", () => {
    try {
      parseAndValidate("not json at all", Simple);
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as JsonValidationError).cause).toBeUndefined();
    }
  });
});
