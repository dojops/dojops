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

  it("throws for hcl format with structured data", () => {
    expect(() => serialize({ key: "value" }, "hcl")).toThrow(
      'Serializer "hcl" does not support structured data in v1',
    );
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
});
