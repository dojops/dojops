import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdirOwnerOnly, writeFileOwnerOnly, mkdirExecutable, chmodExecutable } from "../secure-fs";

describe("secure-fs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-secure-fs-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("mkdirOwnerOnly creates directory with 0o700", () => {
    const dir = path.join(tmpDir, "owner-only");
    mkdirOwnerOnly(dir);
    expect(fs.existsSync(dir)).toBe(true);
    const stat = fs.statSync(dir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it("mkdirOwnerOnly creates nested directories", () => {
    const dir = path.join(tmpDir, "a", "b", "c");
    mkdirOwnerOnly(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("writeFileOwnerOnly writes with 0o600", () => {
    const file = path.join(tmpDir, "secret.txt");
    writeFileOwnerOnly(file, "secret-data");
    expect(fs.readFileSync(file, "utf-8")).toBe("secret-data");
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("mkdirExecutable creates directory with 0o755", () => {
    const dir = path.join(tmpDir, "exec-dir");
    mkdirExecutable(dir);
    expect(fs.existsSync(dir)).toBe(true);
    const stat = fs.statSync(dir);
    expect(stat.mode & 0o777).toBe(0o755);
  });

  it("chmodExecutable sets 0o755 on file", () => {
    const file = path.join(tmpDir, "run.sh");
    fs.writeFileSync(file, "#!/bin/sh\necho hi");
    chmodExecutable(file);
    const stat = fs.statSync(file);
    expect(stat.mode & 0o777).toBe(0o755);
  });
});
