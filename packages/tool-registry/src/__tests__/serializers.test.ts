import { describe, it, expect } from "vitest";
import { serialize } from "../serializers";

describe("serialize", () => {
  it("serializes to YAML", () => {
    const result = serialize({ name: "test", count: 3 }, "yaml");
    expect(result).toContain("name: test");
    expect(result).toContain("count: 3");
  });

  it("serializes to JSON", () => {
    const result = serialize({ name: "test" }, "json");
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe("test");
  });

  it("serializes JSON with 2-space indent and trailing newline", () => {
    const result = serialize({ a: 1 }, "json");
    expect(result).toMatch(/^\{\n {2}"a": 1\n\}\n$/);
  });

  it("serializes raw string passthrough", () => {
    const result = serialize("raw content here", "raw");
    expect(result).toBe("raw content here");
  });

  it("serializes raw non-string as JSON", () => {
    const result = serialize({ key: "val" }, "raw");
    expect(JSON.parse(result)).toEqual({ key: "val" });
  });

  it("falls back to raw for hcl format (string)", () => {
    const result = serialize("resource {}", "hcl");
    expect(result).toBe("resource {}");
  });

  it("serializes hcl format with structured data", () => {
    const result = serialize({ key: "value" }, "hcl");
    expect(result).toContain('key = "value"');
  });

  it("falls back to raw for ini format", () => {
    const result = serialize("[section]\nkey=value", "ini");
    expect(result).toBe("[section]\nkey=value");
  });

  it("falls back to raw for toml format", () => {
    const result = serialize("key = 'value'", "toml");
    expect(result).toBe("key = 'value'");
  });

  it("throws for unknown format", () => {
    expect(() => serialize("data", "xml")).toThrow("Unknown serializer format: xml");
  });

  it("handles nested YAML objects", () => {
    const result = serialize({ a: { b: { c: 1 } } }, "yaml");
    expect(result).toContain("a:");
    expect(result).toContain("  b:");
    expect(result).toContain("    c: 1");
  });

  it("handles arrays in YAML", () => {
    const result = serialize({ items: ["a", "b", "c"] }, "yaml");
    expect(result).toContain("- a");
    expect(result).toContain("- b");
  });

  it("serializes nested HCL blocks", () => {
    const result = serialize({ provider: { aws: { region: "us-east-1" } } }, "hcl");
    expect(result).toContain("provider {");
    expect(result).toContain("  aws {");
    expect(result).toContain('    region = "us-east-1"');
  });

  it("serializes HCL booleans and numbers", () => {
    const result = serialize({ config: { enabled: true, count: 3 } }, "hcl");
    expect(result).toContain("enabled = true");
    expect(result).toContain("count = 3");
  });

  it("serializes HCL null values", () => {
    const result = serialize({ config: { value: null } }, "hcl");
    expect(result).toContain("value = null");
  });

  it("serializes HCL empty arrays", () => {
    const result = serialize({ config: { items: [] } }, "hcl");
    expect(result).toContain("items = []");
  });

  it("serializes HCL arrays with values", () => {
    const result = serialize({ tags: { items: ["a", "b"] } }, "hcl");
    expect(result).toContain('items = ["a", "b"]');
  });

  it("serializes HCL inline objects", () => {
    const result = serialize({ config: { meta: { nested: { key: "val" } } } }, "hcl");
    expect(result).toContain("meta {");
    expect(result).toContain('key = "val"');
  });

  it("escapes special characters in HCL strings", () => {
    const result = serialize({ config: { path: 'C:\\dir\t"name"\n' } }, "hcl");
    expect(result).toContain("\\\\");
    expect(result).toContain(String.raw`\"`);
    expect(result).toContain(String.raw`\n`);
    expect(result).toContain(String.raw`\t`);
  });

  it("throws for HCL with non-string non-object data", () => {
    expect(() => serialize(42, "hcl")).toThrow("requires a string or object");
  });

  it("throws for ini with non-string data", () => {
    expect(() => serialize({ key: "value" }, "ini")).toThrow("does not support structured data");
  });

  it("throws for toml with non-string data", () => {
    expect(() => serialize({ key: "value" }, "toml")).toThrow("does not support structured data");
  });

  it("serializes HCL with undefined values", () => {
    const result = serialize({ config: { value: undefined } }, "hcl");
    expect(result).toContain("value = null");
  });

  it("serializes HCL empty inline objects", () => {
    // An array containing an object triggers the inline object path
    const result = serialize({ items: [{ a: 1, b: 2 }] }, "hcl");
    expect(result).toContain("a = 1");
  });
});
