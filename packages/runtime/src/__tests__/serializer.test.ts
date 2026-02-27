import { describe, it, expect } from "vitest";
import { serialize } from "../serializer";

describe("serialize", () => {
  describe("yaml", () => {
    it("serializes object to YAML", () => {
      const result = serialize({ name: "test", value: 42 }, "yaml");
      expect(result).toContain("name: test");
      expect(result).toContain("value: 42");
    });

    it("applies key ordering", () => {
      const result = serialize({ jobs: { build: "yes" }, on: { push: true }, name: "CI" }, "yaml", {
        keyOrder: ["name", "on", "jobs"],
      });
      const lines = result.split("\n").filter((l) => l.length > 0);
      const nameIdx = lines.findIndex((l) => l.startsWith("name:"));
      const onIdx = lines.findIndex((l) => /^on:/.test(l) || /^'on':/.test(l));
      const jobsIdx = lines.findIndex((l) => l.startsWith("jobs:"));
      expect(nameIdx).toBeGreaterThanOrEqual(0);
      expect(onIdx).toBeGreaterThanOrEqual(0);
      expect(jobsIdx).toBeGreaterThanOrEqual(0);
      expect(nameIdx).toBeLessThan(onIdx);
      expect(onIdx).toBeLessThan(jobsIdx);
    });

    it("sorts keys by default", () => {
      const result = serialize({ z: 1, a: 2, m: 3 }, "yaml");
      const lines = result.trim().split("\n");
      expect(lines[0]).toBe("a: 2");
      expect(lines[1]).toBe("m: 3");
      expect(lines[2]).toBe("z: 1");
    });

    it("supports multi-document YAML", () => {
      const result = serialize([{ kind: "Deployment" }, { kind: "Service" }], "yaml", {
        multiDocument: true,
      });
      expect(result).toContain("kind: Deployment");
      expect(result).toContain("---");
      expect(result).toContain("kind: Service");
    });
  });

  describe("json", () => {
    it("serializes to indented JSON", () => {
      const result = serialize({ key: "value" }, "json");
      expect(result).toBe('{\n  "key": "value"\n}\n');
    });

    it("respects indent option", () => {
      const result = serialize({ key: "value" }, "json", { indent: 4 });
      expect(result).toBe('{\n    "key": "value"\n}\n');
    });
  });

  describe("hcl", () => {
    it("serializes basic HCL", () => {
      const result = serialize({ resource: { ami: "ami-123" } }, "hcl");
      expect(result).toContain("resource {");
      expect(result).toContain('ami = "ami-123"');
    });

    it("uses map syntax for mapAttributes", () => {
      const result = serialize({ tags: { Name: "test", Env: "prod" } }, "hcl", {
        mapAttributes: ["tags"],
      });
      expect(result).toContain("tags = {");
      expect(result).toContain('Name = "test"');
    });

    it("uses block syntax for non-map attributes", () => {
      const result = serialize({ ingress: { from_port: 80 } }, "hcl", { mapAttributes: [] });
      expect(result).toContain("ingress {");
      expect(result).toContain("from_port = 80");
    });

    it("passes through strings", () => {
      const hcl = 'resource "aws_instance" "web" {\n  ami = "ami-123"\n}\n';
      const result = serialize(hcl, "hcl");
      expect(result).toBe(hcl);
    });

    it("serializes arrays", () => {
      const result = serialize({ ports: [80, 443] }, "hcl");
      expect(result).toContain("ports = [80, 443]");
    });

    it("escapes strings", () => {
      const result = serialize({ msg: 'hello "world"\nnewline' }, "hcl");
      expect(result).toContain('msg = "hello \\"world\\"\\nnewline"');
    });
  });

  describe("raw", () => {
    it("passes through strings", () => {
      expect(serialize("raw content", "raw")).toBe("raw content");
    });

    it("JSON-stringifies non-strings", () => {
      const result = serialize({ key: "value" }, "raw");
      expect(result).toContain('"key"');
    });
  });

  describe("unsupported formats", () => {
    it("throws on unknown format", () => {
      expect(() => serialize("data", "xml")).toThrow("Unknown serializer format: xml");
    });

    it("ini throws on structured data", () => {
      expect(() => serialize({ key: "val" }, "ini")).toThrow(
        'Serializer "ini" does not support structured data',
      );
    });
  });
});
