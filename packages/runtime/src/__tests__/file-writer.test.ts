import { describe, it, expect } from "vitest";
import {
  serializeForFile,
  detectExistingContent,
  writeFiles,
  matchesScopePattern,
} from "../file-writer";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

  it("detects files with glob in directory segment (e.g. actions/*/action.yml)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-test-"));
    try {
      const actionsDir = path.join(tmpDir, ".github", "actions");
      fs.mkdirSync(path.join(actionsDir, "setup-node"), { recursive: true });
      fs.mkdirSync(path.join(actionsDir, "docker-build"), { recursive: true });
      fs.writeFileSync(
        path.join(actionsDir, "setup-node", "action.yml"),
        "name: Setup Node",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(actionsDir, "docker-build", "action.yml"),
        "name: Docker Build",
        "utf-8",
      );

      const content = detectExistingContent([".github/actions/*/action.yml"], tmpDir);
      expect(content).not.toBeNull();
      expect(content).toContain("name: Setup Node");
      expect(content).toContain("name: Docker Build");
      expect(content).toContain("docker-build");
      expect(content).toContain("setup-node");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns all matching files concatenated with path headers", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-test-"));
    try {
      const wfDir = path.join(tmpDir, ".github", "workflows");
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(wfDir, "ci.yml"), "name: CI", "utf-8");
      fs.writeFileSync(path.join(wfDir, "deploy.yml"), "name: Deploy", "utf-8");

      const content = detectExistingContent([".github/workflows/*.yml"], tmpDir);
      expect(content).not.toBeNull();
      // Multiple files → path headers
      expect(content).toContain("--- .github/workflows/ci.yml ---");
      expect(content).toContain("--- .github/workflows/deploy.yml ---");
      expect(content).toContain("name: CI");
      expect(content).toContain("name: Deploy");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("matchesScopePattern", () => {
  it("matches after variable expansion", () => {
    const result = matchesScopePattern("infra/main.tf", ["{projectPath}/main.tf"], {
      projectPath: "infra",
    });
    expect(result).toBe(true);
  });

  it("rejects non-matching path", () => {
    const result = matchesScopePattern("other/secret.txt", ["{projectPath}/main.tf"], {
      projectPath: "infra",
    });
    expect(result).toBe(false);
  });

  it("matches any pattern in the list", () => {
    const result = matchesScopePattern(
      "out/.dockerignore",
      ["{outputPath}/Dockerfile", "{outputPath}/.dockerignore"],
      { outputPath: "out" },
    );
    expect(result).toBe(true);
  });
});

describe("writeFiles with scope enforcement", () => {
  it("passes for in-scope paths", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-scope-"));
    try {
      const result = writeFiles(
        { key: "value" },
        [{ path: "{outputPath}/out.yaml", format: "yaml", source: "llm" as const }],
        { outputPath: tmpDir },
        false,
        { write: ["{outputPath}/out.yaml"] },
      );
      expect(result.filesWritten).toHaveLength(1);
      expect(fs.existsSync(path.join(tmpDir, "out.yaml"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("throws for out-of-scope paths", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-scope-"));
    try {
      expect(() =>
        writeFiles(
          { key: "value" },
          [{ path: "{outputPath}/secret.txt", format: "raw", source: "llm" as const }],
          { outputPath: tmpDir },
          false,
          { write: ["{outputPath}/out.yaml"] },
        ),
      ).toThrow("not in declared write scope");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("allows all paths when no scope is provided", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-scope-"));
    try {
      const result = writeFiles(
        { key: "value" },
        [{ path: "{outputPath}/anything.yaml", format: "yaml", source: "llm" as const }],
        { outputPath: tmpDir },
        false,
      );
      expect(result.filesWritten).toHaveLength(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
