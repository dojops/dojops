import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readExistingConfig, backupFile, atomicWriteFileSync, restoreBackup } from "../file-reader";

describe("readExistingConfig", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-test-"));
  const testFile = path.join(tmpDir, "test.yml");

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it("returns null for non-existent file", () => {
    expect(readExistingConfig(path.join(tmpDir, "missing.yml"))).toBeNull();
  });

  it("reads existing file content", () => {
    fs.writeFileSync(testFile, "name: ci\non: push", "utf-8");
    expect(readExistingConfig(testFile)).toBe("name: ci\non: push");
  });

  it("returns null for files larger than 50KB", () => {
    const largeContent = "x".repeat(51 * 1024);
    fs.writeFileSync(testFile, largeContent, "utf-8");
    expect(readExistingConfig(testFile)).toBeNull();
  });

  it("reads files up to exactly 50KB", () => {
    const content = "y".repeat(50 * 1024);
    fs.writeFileSync(testFile, content, "utf-8");
    expect(readExistingConfig(testFile)).toBe(content);
  });
});

describe("backupFile", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-backup-"));
  const testFile = path.join(tmpDir, "config.yml");
  const bakFile = `${testFile}.bak`;

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it("creates .bak copy of existing file", () => {
    fs.writeFileSync(testFile, "original content", "utf-8");
    backupFile(testFile);
    expect(fs.existsSync(bakFile)).toBe(true);
    expect(fs.readFileSync(bakFile, "utf-8")).toBe("original content");
  });

  it("does nothing for non-existent file", () => {
    backupFile(path.join(tmpDir, "nonexistent.yml"));
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it("overwrites existing backup", () => {
    fs.writeFileSync(testFile, "new content", "utf-8");
    fs.writeFileSync(bakFile, "old backup", "utf-8");
    backupFile(testFile);
    expect(fs.readFileSync(bakFile, "utf-8")).toBe("new content");
  });
});

describe("atomicWriteFileSync", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-atomic-"));
  const testFile = path.join(tmpDir, "atomic.yml");

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it("writes file content", () => {
    atomicWriteFileSync(testFile, "hello: world");
    expect(fs.readFileSync(testFile, "utf-8")).toBe("hello: world");
  });

  it("does not leave .tmp file on success", () => {
    atomicWriteFileSync(testFile, "content");
    expect(fs.existsSync(`${testFile}.tmp`)).toBe(false);
  });

  it("overwrites existing file atomically", () => {
    fs.writeFileSync(testFile, "old", "utf-8");
    atomicWriteFileSync(testFile, "new");
    expect(fs.readFileSync(testFile, "utf-8")).toBe("new");
  });

  it("creates parent directories if needed", () => {
    const nestedFile = path.join(tmpDir, "sub", "dir", "file.yml");
    atomicWriteFileSync(nestedFile, "nested content");
    expect(fs.readFileSync(nestedFile, "utf-8")).toBe("nested content");
    // Cleanup nested dirs
    fs.rmSync(path.join(tmpDir, "sub"), { recursive: true });
  });
});

describe("restoreBackup", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-restore-"));
  const testFile = path.join(tmpDir, "config.yml");
  const bakFile = `${testFile}.bak`;

  afterEach(() => {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.unlinkSync(path.join(tmpDir, f));
    }
  });

  it("restores file from .bak", () => {
    fs.writeFileSync(testFile, "modified content", "utf-8");
    fs.writeFileSync(bakFile, "original content", "utf-8");
    const result = restoreBackup(testFile);
    expect(result).toBe(true);
    expect(fs.readFileSync(testFile, "utf-8")).toBe("original content");
    expect(fs.existsSync(bakFile)).toBe(false);
  });

  it("returns false when no .bak exists", () => {
    const result = restoreBackup(path.join(tmpDir, "nonexistent.yml"));
    expect(result).toBe(false);
  });
});
