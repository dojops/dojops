import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  jsonSchemaToZod,
  JSONSchemaObject,
  hasNestedQuantifiers,
  safeRegex,
} from "../json-schema-to-zod";

describe("jsonSchemaToZod", () => {
  it("converts string type", () => {
    const schema: JSONSchemaObject = { type: "string" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse("hello").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(false);
  });

  it("converts string with description", () => {
    const schema: JSONSchemaObject = { type: "string", description: "A name" };
    const zod = jsonSchemaToZod(schema);
    // Verify description is preserved via z.toJSONSchema()
    const jsonSchema = z.toJSONSchema(zod) as Record<string, unknown>;
    expect(jsonSchema.description).toBe("A name");
  });

  it("converts string with default", () => {
    const schema: JSONSchemaObject = { type: "string", default: "hello" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse(undefined)).toBe("hello");
  });

  it("converts number type", () => {
    const schema: JSONSchemaObject = { type: "number" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse(3.14).success).toBe(true);
    expect(zod.safeParse("abc").success).toBe(false);
  });

  it("converts integer type", () => {
    const schema: JSONSchemaObject = { type: "integer" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse(42).success).toBe(true);
    expect(zod.safeParse(3.14).success).toBe(false);
  });

  it("converts number with default", () => {
    const schema: JSONSchemaObject = { type: "number", default: 10 };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse(undefined)).toBe(10);
  });

  it("converts boolean type", () => {
    const schema: JSONSchemaObject = { type: "boolean" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse(true).success).toBe(true);
    expect(zod.safeParse("yes").success).toBe(false);
  });

  it("converts boolean with default", () => {
    const schema: JSONSchemaObject = { type: "boolean", default: false };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse(undefined)).toBe(false);
  });

  it("converts enum", () => {
    const schema: JSONSchemaObject = { enum: ["a", "b", "c"] };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse("a").success).toBe(true);
    expect(zod.safeParse("d").success).toBe(false);
  });

  it("converts enum with description", () => {
    const schema: JSONSchemaObject = { enum: ["x", "y"], description: "Options" };
    const zod = jsonSchemaToZod(schema);
    // Verify description is preserved via z.toJSONSchema()
    const jsonSchema = z.toJSONSchema(zod) as Record<string, unknown>;
    expect(jsonSchema.description).toBe("Options");
  });

  it("converts array of strings", () => {
    const schema: JSONSchemaObject = {
      type: "array",
      items: { type: "string" },
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse(["a", "b"]).success).toBe(true);
    expect(zod.safeParse("not-array").success).toBe(false);
    expect(zod.safeParse([1, 2]).success).toBe(false);
  });

  it("converts array with default", () => {
    const schema: JSONSchemaObject = {
      type: "array",
      items: { type: "string" },
      default: ["default"],
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse(undefined)).toEqual(["default"]);
  });

  it("converts simple object", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse({ name: "Alice" }).success).toBe(true);
    expect(zod.safeParse({ name: "Alice", age: 30 }).success).toBe(true);
    expect(zod.safeParse({ age: 30 }).success).toBe(false); // missing required name
  });

  it("makes non-required fields optional", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        required_field: { type: "string" },
        optional_field: { type: "string" },
      },
      required: ["required_field"],
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse({ required_field: "hello" }).success).toBe(true);
  });

  it("handles nested objects", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            port: { type: "number" },
          },
          required: ["enabled"],
        },
      },
      required: ["config"],
    };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse({ config: { enabled: true } }).success).toBe(true);
    expect(zod.safeParse({ config: { port: 8080 } }).success).toBe(false);
  });

  it("converts object without properties to record", () => {
    const schema: JSONSchemaObject = { type: "object" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse({ any: "thing" }).success).toBe(true);
  });

  it("handles unknown type as z.unknown()", () => {
    const schema: JSONSchemaObject = {};
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse("anything").success).toBe(true);
    expect(zod.safeParse(42).success).toBe(true);
  });

  it("produced schema validates correctly for zodSchemaToText compatibility", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
        enabled: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        mode: { enum: ["fast", "slow"] },
      },
      required: ["name"],
    };
    const zod = jsonSchemaToZod(schema);

    // Verify it behaves as an object schema
    expect(zod.safeParse({ name: "test" }).success).toBe(true);
    expect(zod.safeParse({ name: "test", count: 42 }).success).toBe(true);
    expect(zod.safeParse({}).success).toBe(false);

    // Verify the JSON Schema round-trip preserves structure
    const jsonSchema = z.toJSONSchema(zod) as Record<string, unknown>;
    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toBeDefined();
  });

  it("handles field with default not being marked optional", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        port: { type: "number", default: 3000 },
      },
    };
    const zod = jsonSchemaToZod(schema);
    // Port has a default, so parsing undefined should use default
    const result = zod.parse({ port: undefined });
    expect(result.port).toBe(3000);
  });

  it("converts enum with default", () => {
    const schema: JSONSchemaObject = { enum: ["a", "b"], default: "b" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.parse(undefined)).toBe("b");
  });

  it("converts string with minLength and maxLength", () => {
    const schema: JSONSchemaObject = { type: "string", minLength: 2, maxLength: 5 };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse("ab").success).toBe(true);
    expect(zod.safeParse("a").success).toBe(false);
    expect(zod.safeParse("abcdef").success).toBe(false);
  });

  it("converts string with valid regex pattern", () => {
    const schema: JSONSchemaObject = { type: "string", pattern: "^[a-z]+$" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse("abc").success).toBe(true);
    expect(zod.safeParse("ABC").success).toBe(false);
  });

  it("converts number with min and max", () => {
    const schema: JSONSchemaObject = { type: "number", minimum: 1, maximum: 10 };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse(5).success).toBe(true);
    expect(zod.safeParse(0).success).toBe(false);
    expect(zod.safeParse(11).success).toBe(false);
  });

  it("converts array without items to z.array(z.unknown())", () => {
    const schema: JSONSchemaObject = { type: "array" };
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse([1, "a", true]).success).toBe(true);
  });

  it("warns on unsupported composition keys (allOf)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = { allOf: [{ type: "string" }] } as unknown as JSONSchemaObject;
    const zod = jsonSchemaToZod(schema);
    expect(zod.safeParse("anything").success).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("allOf"));
    warnSpy.mockRestore();
  });

  it("warns on unsupported composition keys (anyOf)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = { anyOf: [{ type: "string" }] } as unknown as JSONSchemaObject;
    jsonSchemaToZod(schema);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("anyOf"));
    warnSpy.mockRestore();
  });
});

describe("hasNestedQuantifiers", () => {
  it("returns false for simple patterns", () => {
    expect(hasNestedQuantifiers("^[a-z]+$")).toBe(false);
    expect(hasNestedQuantifiers("abc")).toBe(false);
    expect(hasNestedQuantifiers("a{1,3}")).toBe(false);
  });

  it("detects adjacent quantifiers (a++)", () => {
    expect(hasNestedQuantifiers("a++")).toBe(true);
  });

  it("detects quantifier after brace (a{1,3}+)", () => {
    expect(hasNestedQuantifiers("a{1,3}+")).toBe(true);
  });

  it("detects nested quantifiers (a*+)", () => {
    expect(hasNestedQuantifiers("a*+")).toBe(true);
  });

  it("detects lazy quantifier followed by quantifier (a+?+)", () => {
    expect(hasNestedQuantifiers("a+?+")).toBe(true);
  });

  it("detects group with inner quantifier followed by outer quantifier", () => {
    expect(hasNestedQuantifiers("(a+)+")).toBe(true);
  });

  it("returns false for group without inner quantifier", () => {
    expect(hasNestedQuantifiers("(abc)+")).toBe(false);
  });

  it("detects group quantifier with brace", () => {
    expect(hasNestedQuantifiers("(a*){2}")).toBe(true);
  });
});

describe("safeRegex", () => {
  it("returns RegExp for safe patterns", () => {
    const re = safeRegex("^[a-z]+$");
    expect(re).toBeInstanceOf(RegExp);
    expect(re.test("abc")).toBe(true);
  });

  it("throws for nested quantifier patterns", () => {
    expect(() => safeRegex("(a+)+")).toThrow("unsafe regex");
  });

  it("throws for invalid regex syntax", () => {
    expect(() => safeRegex("[invalid")).toThrow("Invalid regex");
  });
});
