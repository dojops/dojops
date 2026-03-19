import { describe, it, expect, afterEach } from "vitest";
import { expandFileReferences } from "../input-expander";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("expandFileReferences", () => {
  let tmpDir: string;

  function setup(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-expander-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("expands @path/to/file.ts into <file> tags", () => {
    const dir = setup();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "index.ts"), 'console.log("hello");');

    const result = expandFileReferences("Review @src/index.ts please", dir);

    expect(result).toContain('<file path="src/index.ts">');
    expect(result).toContain('console.log("hello");');
    expect(result).toContain("</file>");
    expect(result).toContain("Review");
    expect(result).toContain("please");
  });

  it("leaves @mentions without extensions unchanged", () => {
    const dir = setup();
    const result = expandFileReferences("Hey @john what do you think?", dir);
    expect(result).toBe("Hey @john what do you think?");
  });

  it("leaves @@escaped references unchanged", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, "file.ts"), "content");

    const result = expandFileReferences("Use @@file.ts for escaping", dir);
    expect(result).toBe("Use @@file.ts for escaping");
    expect(result).not.toContain("<file");
  });

  it("handles relative paths with ./", () => {
    const dir = setup();
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "index.ts"), "export default {};");

    const result = expandFileReferences("Check @./src/index.ts", dir);

    expect(result).toContain('<file path="./src/index.ts">');
    expect(result).toContain("export default {};");
  });

  it("handles relative paths with ../", () => {
    const dir = setup();
    // Create a file in the parent-relative position
    const subDir = path.join(dir, "sub");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"test"}');

    const result = expandFileReferences("See @../package.json", subDir);

    expect(result).toContain('<file path="../package.json">');
    expect(result).toContain('"name":"test"');
  });

  it("skips files larger than 256KB silently", () => {
    const dir = setup();
    // Create a file > 256KB
    const bigContent = "x".repeat(256 * 1024 + 1);
    fs.writeFileSync(path.join(dir, "big.ts"), bigContent);

    const result = expandFileReferences("See @big.ts", dir);

    // Should leave the reference unchanged
    expect(result).toBe("See @big.ts");
    expect(result).not.toContain("<file");
  });

  it("includes files exactly at 256KB", () => {
    const dir = setup();
    const exactContent = "y".repeat(256 * 1024);
    fs.writeFileSync(path.join(dir, "exact.ts"), exactContent);

    const result = expandFileReferences("See @exact.ts", dir);

    expect(result).toContain('<file path="exact.ts">');
  });

  it("skips non-existent files silently", () => {
    const dir = setup();
    const result = expandFileReferences("Check @nonexistent.ts for details", dir);
    expect(result).toBe("Check @nonexistent.ts for details");
  });

  it("handles multiple @file refs in one input", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, "a.ts"), "file A");
    fs.writeFileSync(path.join(dir, "b.ts"), "file B");

    const result = expandFileReferences("Compare @a.ts with @b.ts", dir);

    expect(result).toContain('<file path="a.ts">');
    expect(result).toContain("file A");
    expect(result).toContain('<file path="b.ts">');
    expect(result).toContain("file B");
    // Both closing tags present
    expect(result.match(/<\/file>/g)).toHaveLength(2);
  });

  it("handles mix of valid and invalid file refs", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, "real.ts"), "real content");

    const result = expandFileReferences("@real.ts and @missing.ts and @mention", dir);

    expect(result).toContain('<file path="real.ts">');
    expect(result).toContain("real content");
    // missing.ts should stay as-is
    expect(result).toContain("@missing.ts");
    // @mention has no extension, should stay as-is
    expect(result).toContain("@mention");
  });

  it("does not match word@file.ts (no lookbehind match)", () => {
    const dir = setup();
    fs.writeFileSync(path.join(dir, "file.ts"), "content");

    const result = expandFileReferences("email@file.ts", dir);
    expect(result).toBe("email@file.ts");
    expect(result).not.toContain("<file");
  });

  it("handles empty input", () => {
    const dir = setup();
    const result = expandFileReferences("", dir);
    expect(result).toBe("");
  });

  it("handles input with no file references", () => {
    const dir = setup();
    const result = expandFileReferences("Just a plain prompt with no refs", dir);
    expect(result).toBe("Just a plain prompt with no refs");
  });
});
