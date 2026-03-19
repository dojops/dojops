import { describe, it, expect, afterEach } from "vitest";
import { loadIgnorePatterns, isIgnored } from "../../agents/dojopsignore";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("loadIgnorePatterns", () => {
  let tmpDir: string;

  function setup(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-ignore-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads patterns from .dojopsignore file", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, ".dojopsignore"), "*.generated.ts\nbuild/\nsrc/**/*.test.ts\n");

    const patterns = loadIgnorePatterns(dir);

    expect(patterns).toEqual(["*.generated.ts", "build/", "src/**/*.test.ts"]);
  });

  it("returns empty array when .dojopsignore is missing", () => {
    const dir = setup();
    const patterns = loadIgnorePatterns(dir);
    expect(patterns).toEqual([]);
  });

  it("skips comment lines starting with #", () => {
    const dir = setup();
    fs.writeFileSync(
      path.join(dir, ".dojopsignore"),
      "# This is a comment\n*.log\n# Another comment\nbuild/\n",
    );

    const patterns = loadIgnorePatterns(dir);

    expect(patterns).toEqual(["*.log", "build/"]);
  });

  it("skips empty lines", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, ".dojopsignore"), "*.log\n\n\nbuild/\n\n");

    const patterns = loadIgnorePatterns(dir);

    expect(patterns).toEqual(["*.log", "build/"]);
  });

  it("trims whitespace from lines", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, ".dojopsignore"), "  *.log  \n  build/  \n");

    const patterns = loadIgnorePatterns(dir);

    expect(patterns).toEqual(["*.log", "build/"]);
  });

  it("handles file with only comments and empty lines", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, ".dojopsignore"), "# comment 1\n\n# comment 2\n  \n");

    const patterns = loadIgnorePatterns(dir);

    expect(patterns).toEqual([]);
  });
});

describe("isIgnored", () => {
  describe("bare filename glob (*.generated.ts)", () => {
    const patterns = ["*.generated.ts"];

    it("matches file in root", () => {
      expect(isIgnored("foo.generated.ts", patterns)).toBe(true);
    });

    it("matches file in subdirectory (matchBase behavior)", () => {
      expect(isIgnored("src/bar.generated.ts", patterns)).toBe(true);
    });

    it("does not match non-matching extension", () => {
      expect(isIgnored("foo.generated.js", patterns)).toBe(false);
    });

    it("does not match partial name match", () => {
      expect(isIgnored("foo.ts", patterns)).toBe(false);
    });
  });

  describe("directory pattern (build/)", () => {
    const patterns = ["build/"];

    it("matches the directory name itself", () => {
      // Trailing / is stripped -> pattern "build" -> regex ^build$
      // matchBase applies since no / in pattern
      expect(isIgnored("build", patterns)).toBe(true);
    });

    it("matches directory name as basename in nested path", () => {
      // basename("src/build") = "build" matches ^build$ via matchBase
      expect(isIgnored("src/build", patterns)).toBe(true);
    });

    it("does not match files inside the directory (simple glob)", () => {
      // The implementation strips trailing /, creates ^build$,
      // which does NOT match paths containing build/ as a prefix
      expect(isIgnored("build/output.js", patterns)).toBe(false);
    });

    it("does not match file with build in the name", () => {
      expect(isIgnored("src/build.ts", patterns)).toBe(false);
    });
  });

  describe("directory pattern with globstar (build/**)", () => {
    const patterns = ["build/**"];

    it("matches file inside directory", () => {
      expect(isIgnored("build/output.js", patterns)).toBe(true);
    });

    it("matches deeply nested file inside directory", () => {
      expect(isIgnored("build/deep/nested/file.js", patterns)).toBe(true);
    });
  });

  describe("glob pattern (src/**/*.test.ts)", () => {
    const patterns = ["src/**/*.test.ts"];

    it("matches test file in src subdirectory", () => {
      expect(isIgnored("src/deep/foo.test.ts", patterns)).toBe(true);
    });

    it("matches test file in deeply nested src subdirectory", () => {
      expect(isIgnored("src/a/b/c/foo.test.ts", patterns)).toBe(true);
    });

    it("does not match test file directly in src (** requires at least one /)", () => {
      // Pattern: src/**/*.test.ts -> regex: ^src/.*/[^/]*\.test\.ts$
      // src/foo.test.ts needs a / after src/ before the filename, but
      // .* matches empty and the next char is a literal /, so this
      // requires at least one directory level between src/ and *.test.ts
      expect(isIgnored("src/foo.test.ts", patterns)).toBe(false);
    });

    it("does not match test file outside src", () => {
      expect(isIgnored("lib/foo.test.ts", patterns)).toBe(false);
    });

    it("does not match non-test file in src", () => {
      expect(isIgnored("src/deep/foo.ts", patterns)).toBe(false);
    });
  });

  describe("literal filename (specific-file.yml)", () => {
    const patterns = ["specific-file.yml"];

    it("matches exact filename in root", () => {
      expect(isIgnored("specific-file.yml", patterns)).toBe(true);
    });

    it("matches exact filename in subdirectory (matchBase)", () => {
      expect(isIgnored("config/specific-file.yml", patterns)).toBe(true);
    });

    it("does not match different filename", () => {
      expect(isIgnored("other-file.yml", patterns)).toBe(false);
    });
  });

  describe("non-matches", () => {
    it("returns false when no patterns match", () => {
      const patterns = ["*.log", "build/", "dist/"];
      expect(isIgnored("src/index.ts", patterns)).toBe(false);
    });

    it("returns false for empty patterns array", () => {
      expect(isIgnored("anything.ts", [])).toBe(false);
    });
  });

  describe("multiple patterns", () => {
    it("matches if any pattern matches", () => {
      const patterns = ["*.log", "build/**", "*.generated.ts"];
      expect(isIgnored("app.log", patterns)).toBe(true);
      expect(isIgnored("build/output.js", patterns)).toBe(true);
      expect(isIgnored("types.generated.ts", patterns)).toBe(true);
    });

    it("returns false when none match", () => {
      const patterns = ["*.log", "build/**", "*.generated.ts"];
      expect(isIgnored("src/index.ts", patterns)).toBe(false);
    });
  });

  describe("question mark wildcard", () => {
    const patterns = ["?.ts"];

    it("matches single character", () => {
      expect(isIgnored("a.ts", patterns)).toBe(true);
    });

    it("does not match multiple characters", () => {
      expect(isIgnored("ab.ts", patterns)).toBe(false);
    });
  });
});
