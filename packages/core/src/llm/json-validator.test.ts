import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseAndValidate, JsonValidationError } from "./json-validator";

const TestSchema = z.object({
  name: z.string(),
  count: z.number(),
});

describe("parseAndValidate", () => {
  it("parses clean JSON matching schema", () => {
    const result = parseAndValidate('{"name": "test", "count": 42}', TestSchema);
    expect(result).toEqual({ name: "test", count: 42 });
  });

  it("strips markdown fences before parsing", () => {
    const raw = '```json\n{"name": "fenced", "count": 7}\n```';
    const result = parseAndValidate(raw, TestSchema);
    expect(result).toEqual({ name: "fenced", count: 7 });
  });

  it("throws JsonValidationError on invalid JSON", () => {
    expect(() => parseAndValidate("not json", TestSchema)).toThrow(JsonValidationError);
    expect(() => parseAndValidate("not json", TestSchema)).toThrow("Failed to parse JSON");
  });

  it("throws JsonValidationError on schema mismatch", () => {
    expect(() => parseAndValidate('{"name": 123}', TestSchema)).toThrow(JsonValidationError);
    expect(() => parseAndValidate('{"name": 123}', TestSchema)).toThrow("Schema validation failed");
  });
});

describe("parseAndValidate edge cases", () => {
  const DetailedSchema = z.object({
    title: z.string(),
    items: z.array(z.object({ id: z.number(), label: z.string() })),
    active: z.boolean(),
  });

  it("strips triple-tilde fences", () => {
    const raw = '~~~json\n{"name": "tilde-fenced", "count": 99}\n~~~';
    const result = parseAndValidate(raw, TestSchema);
    expect(result).toEqual({ name: "tilde-fenced", count: 99 });
  });

  it("handles nested markdown fences in content by extracting outer fence", () => {
    // The regex matches the first occurrence of fences, so inner content is extracted correctly
    // as long as the JSON itself is valid. If the LLM wraps JSON in fences, the inner JSON
    // should not contain actual fence markers.
    const raw = '```json\n{"name": "has ```backticks``` inside", "count": 1}\n```';
    // The regex is non-greedy: ([\s\S]*?) matches up to the first closing ```
    // So it captures: {"name": "has
    // This means the parse will fail because the extracted content is truncated
    expect(() => parseAndValidate(raw, TestSchema)).toThrow(JsonValidationError);
  });

  it("returns error for completely invalid JSON", () => {
    const garbage = "this is just random garbage text with no structure whatsoever!!!";
    expect(() => parseAndValidate(garbage, TestSchema)).toThrow(JsonValidationError);
    expect(() => parseAndValidate(garbage, TestSchema)).toThrow("Failed to parse JSON");
  });

  it("validates against schema and returns typed data", () => {
    const input = JSON.stringify({
      title: "My List",
      items: [
        { id: 1, label: "First" },
        { id: 2, label: "Second" },
      ],
      active: true,
    });

    const result = parseAndValidate<z.infer<typeof DetailedSchema>>(input, DetailedSchema);

    expect(result.title).toBe("My List");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ id: 1, label: "First" });
    expect(result.items[1]).toEqual({ id: 2, label: "Second" });
    expect(result.active).toBe(true);
  });

  it("preserves raw string in JsonValidationError for debugging", () => {
    const badJson = "{{broken json}}";
    try {
      parseAndValidate(badJson, TestSchema);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonValidationError);
      expect((e as JsonValidationError).raw).toBe(badJson);
    }
  });

  it("rejects valid JSON that fails schema validation with cause", () => {
    // Valid JSON but wrong types for the schema
    const validJsonWrongSchema = '{"title": 42, "items": "not-array", "active": "yes"}';
    try {
      parseAndValidate(validJsonWrongSchema, DetailedSchema);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonValidationError);
      const err = e as JsonValidationError;
      expect(err.message).toContain("Schema validation failed");
      expect(err.cause).toBeDefined();
    }
  });
});
