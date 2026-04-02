import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseGenericFiles, writeGenericFiles } from "../../commands/apply";

describe("parseGenericFiles", () => {
  it("parses valid JSON with files map", () => {
    const raw = JSON.stringify({
      files: {
        ".editorconfig": "root = true\n[*]\nindent_style = space\n",
        Makefile: "all:\n\techo hello\n",
      },
    });
    const result = parseGenericFiles(raw);
    expect(result).toEqual({
      ".editorconfig": "root = true\n[*]\nindent_style = space\n",
      Makefile: "all:\n\techo hello\n",
    });
  });

  it("returns null for plain text", () => {
    expect(parseGenericFiles("Just some config text")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGenericFiles("")).toBeNull();
  });

  it("returns null for JSON without files field", () => {
    expect(parseGenericFiles('{"content": "hello"}')).toBeNull();
  });

  it("returns null for JSON with empty files map", () => {
    expect(parseGenericFiles('{"files": {}}')).toBeNull();
  });

  it("returns null for invalid JSON that starts with {", () => {
    expect(parseGenericFiles("{not valid json")).toBeNull();
  });

  it("ignores non-string values in files map", () => {
    const raw = JSON.stringify({
      files: {
        "valid.txt": "content",
        invalid: 123,
        "also-invalid": null,
      },
    });
    const result = parseGenericFiles(raw);
    expect(result).toEqual({ "valid.txt": "content" });
  });

  it("ignores empty-key entries in files map", () => {
    const raw = JSON.stringify({
      files: {
        "": "should be ignored",
        "valid.txt": "content",
      },
    });
    const result = parseGenericFiles(raw);
    expect(result).toEqual({ "valid.txt": "content" });
  });

  it("returns null when all files entries are invalid", () => {
    const raw = JSON.stringify({
      files: {
        "": "empty key",
        num: 42,
      },
    });
    expect(parseGenericFiles(raw)).toBeNull();
  });

  it("handles leading/trailing whitespace around JSON", () => {
    const raw = `  \n  {"files": {"a.txt": "hello"}}  \n  `;
    const result = parseGenericFiles(raw);
    expect(result).toEqual({ "a.txt": "hello" });
  });

  it("returns null for files field that is not an object", () => {
    expect(parseGenericFiles('{"files": "not an object"}')).toBeNull();
    expect(parseGenericFiles('{"files": [1,2,3]}')).toBeNull();
  });
});

describe("writeGenericFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-generic-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes new files and reports them as created", () => {
    const files = {
      "config.yml": "key: value\n",
      "scripts/run.sh": "#!/bin/bash\necho hi\n",
    };
    const result = writeGenericFiles(files, tmpDir);

    expect(result.filesWritten).toEqual(["config.yml", "scripts/run.sh"]);
    expect(result.filesModified).toEqual([]);

    expect(fs.readFileSync(path.join(tmpDir, "config.yml"), "utf-8")).toBe("key: value\n");
    expect(fs.readFileSync(path.join(tmpDir, "scripts/run.sh"), "utf-8")).toBe(
      "#!/bin/bash\necho hi\n",
    );
  });

  it("creates parent directories for nested paths", () => {
    const files = { "deep/nested/dir/file.txt": "content" };
    writeGenericFiles(files, tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "deep/nested/dir/file.txt"))).toBe(true);
  });

  it("modifies existing files and creates .bak backup", () => {
    const filePath = path.join(tmpDir, "existing.txt");
    fs.writeFileSync(filePath, "old content", "utf-8");

    const result = writeGenericFiles({ "existing.txt": "new content" }, tmpDir);

    expect(result.filesWritten).toEqual([]);
    expect(result.filesModified).toEqual(["existing.txt"]);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("new content");
    expect(fs.readFileSync(`${filePath}.bak`, "utf-8")).toBe("old content");
  });

  it("handles a mix of new and existing files", () => {
    fs.writeFileSync(path.join(tmpDir, "old.txt"), "old", "utf-8");

    const files = {
      "old.txt": "updated",
      "new.txt": "fresh",
    };
    const result = writeGenericFiles(files, tmpDir);

    expect(result.filesWritten).toEqual(["new.txt"]);
    expect(result.filesModified).toEqual(["old.txt"]);
  });

  it("handles empty files map gracefully", () => {
    const result = writeGenericFiles({}, tmpDir);
    expect(result.filesWritten).toEqual([]);
    expect(result.filesModified).toEqual([]);
  });
});
