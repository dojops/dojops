import { describe, it, expect } from "vitest";
import { compileInputSchema, compileOutputSchema, jsonSchemaToZod } from "../schema-compiler";

describe("compileInputSchema", () => {
  it("compiles string fields", () => {
    const schema = compileInputSchema({
      name: { type: "string", required: true, description: "A name" },
    });
    const result = schema.safeParse({ name: "test" });
    expect(result.success).toBe(true);
  });

  it("makes non-required fields optional", () => {
    const schema = compileInputSchema({
      name: { type: "string" },
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("applies string constraints", () => {
    const schema = compileInputSchema({
      name: { type: "string", required: true, minLength: 2, maxLength: 10 },
    });
    expect(schema.safeParse({ name: "a" }).success).toBe(false);
    expect(schema.safeParse({ name: "ab" }).success).toBe(true);
    expect(schema.safeParse({ name: "a".repeat(11) }).success).toBe(false);
  });

  it("compiles enum fields", () => {
    const schema = compileInputSchema({
      provider: { type: "enum", values: ["aws", "gcp", "azure"], required: true },
    });
    expect(schema.safeParse({ provider: "aws" }).success).toBe(true);
    expect(schema.safeParse({ provider: "invalid" }).success).toBe(false);
  });

  it("compiles integer fields", () => {
    const schema = compileInputSchema({
      count: { type: "integer", required: true, min: 1, max: 100 },
    });
    expect(schema.safeParse({ count: 5 }).success).toBe(true);
    expect(schema.safeParse({ count: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ count: 0 }).success).toBe(false);
  });

  it("compiles boolean fields", () => {
    const schema = compileInputSchema({
      enabled: { type: "boolean", default: true },
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("compiles array fields", () => {
    const schema = compileInputSchema({
      tags: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
    });
    expect(schema.safeParse({ tags: ["a"] }).success).toBe(true);
    expect(schema.safeParse({ tags: [] }).success).toBe(false);
  });

  it("auto-injects existingContent field", () => {
    const schema = compileInputSchema({ name: { type: "string" } });
    const result = schema.safeParse({ existingContent: "some content" });
    expect(result.success).toBe(true);
  });
});

describe("jsonSchemaToZod", () => {
  it("handles string type", () => {
    const schema = jsonSchemaToZod({ type: "string" });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(false);
  });

  it("handles string with constraints", () => {
    const schema = jsonSchemaToZod({ type: "string", minLength: 2, maxLength: 5 });
    expect(schema.safeParse("a").success).toBe(false);
    expect(schema.safeParse("ab").success).toBe(true);
    expect(schema.safeParse("abcdef").success).toBe(false);
  });

  it("handles number type", () => {
    const schema = jsonSchemaToZod({ type: "number", minimum: 0, maximum: 100 });
    expect(schema.safeParse(50).success).toBe(true);
    expect(schema.safeParse(-1).success).toBe(false);
  });

  it("handles integer type", () => {
    const schema = jsonSchemaToZod({ type: "integer" });
    expect(schema.safeParse(5).success).toBe(true);
    expect(schema.safeParse(5.5).success).toBe(false);
  });

  it("handles boolean type", () => {
    const schema = jsonSchemaToZod({ type: "boolean" });
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse("yes").success).toBe(false);
  });

  it("handles array with items", () => {
    const schema = jsonSchemaToZod({
      type: "array",
      items: { type: "string" },
      minItems: 1,
    });
    expect(schema.safeParse(["a"]).success).toBe(true);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse([1]).success).toBe(false);
  });

  it("handles maxItems", () => {
    const schema = jsonSchemaToZod({
      type: "array",
      items: { type: "string" },
      maxItems: 2,
    });
    expect(schema.safeParse(["a", "b"]).success).toBe(true);
    expect(schema.safeParse(["a", "b", "c"]).success).toBe(false);
  });

  it("handles object with properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    });
    expect(schema.safeParse({ name: "test" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("handles enum", () => {
    const schema = jsonSchemaToZod({ enum: ["a", "b", "c"] });
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("d").success).toBe(false);
  });

  it("handles anyOf as union", () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(true);
    expect(schema.safeParse(true).success).toBe(false);
  });

  it("handles oneOf as union", () => {
    const schema = jsonSchemaToZod({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
    expect(schema.safeParse("hello").success).toBe(true);
    expect(schema.safeParse(42).success).toBe(true);
  });

  it("handles object without properties as record", () => {
    const schema = jsonSchemaToZod({ type: "object" });
    expect(schema.safeParse({ any: "thing" }).success).toBe(true);
  });

  it("handles defaults", () => {
    const schema = jsonSchemaToZod({ type: "string", default: "hello" });
    const result = schema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("hello");
    }
  });
});

describe("compileOutputSchema", () => {
  it("compiles a complex output schema", () => {
    const schema = compileOutputSchema({
      type: "object",
      required: ["resources"],
      properties: {
        resources: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["type", "name"],
            properties: {
              type: { type: "string" },
              name: { type: "string" },
              config: { type: "object" },
            },
          },
        },
      },
    });

    const valid = schema.safeParse({
      resources: [{ type: "aws_s3_bucket", name: "main", config: {} }],
    });
    expect(valid.success).toBe(true);

    const invalid = schema.safeParse({ resources: [] });
    expect(invalid.success).toBe(false);
  });
});
