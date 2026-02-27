import { describe, it, expect } from "vitest";
import { serializeForFile, detectExistingContent } from "../file-writer";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("serializeForFile", () => {
  it("serializes YAML with options", () => {
    const result = serializeForFile(
      { name: "test", value: 42 },
      { path: "out.yaml", format: "yaml", source: "llm" },
    );
    expect(result).toContain("name: test");
    expect(result).toContain("value: 42");
  });

  it("serializes JSON", () => {
    const result = serializeForFile(
      { key: "val" },
      { path: "out.json", format: "json", source: "llm" },
    );
    expect(JSON.parse(result)).toEqual({ key: "val" });
  });

  it("renders templates", () => {
    const result = serializeForFile(
      { appName: "my-app", version: "1.0" },
      {
        path: "out.yaml",
        format: "yaml",
        source: "template",
        content: "name: {{ .Values.appName }}\nversion: {{ .Values.version }}",
      },
    );
    expect(result).toContain("name: my-app");
    expect(result).toContain("version: 1.0");
  });

  it("serializes multi-document YAML", () => {
    const result = serializeForFile([{ kind: "Deployment" }, { kind: "Service" }], {
      path: "out.yaml",
      format: "yaml",
      source: "llm",
      multiDocument: true,
    });
    expect(result).toContain("kind: Deployment");
    expect(result).toContain("---");
    expect(result).toContain("kind: Service");
  });
});

describe("serializeForFile with dataPath", () => {
  it("resolves dataPath to select sub-field", () => {
    const result = serializeForFile(
      { values: { name: "my-app", port: 80 }, extra: "ignored" },
      { path: "values.yaml", format: "yaml", source: "llm", dataPath: "values" },
    );
    expect(result).toContain("name: my-app");
    expect(result).toContain("port: 80");
    expect(result).not.toContain("extra");
    expect(result).not.toContain("ignored");
  });

  it("serializes full data when no dataPath", () => {
    const result = serializeForFile(
      { name: "test", value: 42 },
      { path: "out.yaml", format: "yaml", source: "llm" },
    );
    expect(result).toContain("name: test");
    expect(result).toContain("value: 42");
  });

  it("handles raw format with dataPath to string", () => {
    const result = serializeForFile(
      { content: 'FROM node:20\nCMD ["node", "app.js"]', other: "data" },
      { path: "Dockerfile", format: "raw", source: "llm", dataPath: "content" },
    );
    expect(result).toBe('FROM node:20\nCMD ["node", "app.js"]');
  });

  it("handles nested dataPath", () => {
    const result = serializeForFile(
      { config: { nested: { key: "value" } } },
      { path: "out.json", format: "json", source: "llm", dataPath: "config.nested" },
    );
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("returns undefined data when dataPath does not exist", () => {
    const result = serializeForFile(
      { other: "data" },
      { path: "out.json", format: "json", source: "llm", dataPath: "missing" },
    );
    // undefined serialized as JSON
    expect(result).toBeDefined();
  });
});

describe("detectExistingContent", () => {
  it("detects existing file by exact path", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "main.tf"), "# existing", "utf-8");
      const content = detectExistingContent(["main.tf"], tmpDir);
      expect(content).toBe("# existing");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects existing file by glob pattern", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "config.tf"), "# terraform", "utf-8");
      const content = detectExistingContent(["*.tf"], tmpDir);
      expect(content).toBe("# terraform");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when no files match", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-test-"));
    try {
      const content = detectExistingContent(["*.tf"], tmpDir);
      expect(content).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
