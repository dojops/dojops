import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectProjectType } from "./detector";

describe("detectProjectType", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-detect-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects Node.js project from package.json", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
    const result = detectProjectType(dir);
    expect(result.type).toBe("node");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects Python project from requirements.txt", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "requirements.txt"), "");
    const result = detectProjectType(dir);
    expect(result.type).toBe("python");
  });

  it("detects Go project from go.mod", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "go.mod"), "");
    const result = detectProjectType(dir);
    expect(result.type).toBe("go");
  });

  it("returns unknown for empty directory", () => {
    const dir = makeTmpDir();
    const result = detectProjectType(dir);
    expect(result.type).toBe("unknown");
    expect(result.confidence).toBe(0);
  });
});
