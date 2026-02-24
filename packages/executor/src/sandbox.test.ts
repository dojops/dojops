import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createSandboxedFs, withTimeout } from "./sandbox";
import { PolicyViolationError, DEFAULT_POLICY } from "./policy";
import { ExecutionPolicy } from "./types";

function policy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return { ...DEFAULT_POLICY, ...overrides };
}

describe("createSandboxedFs", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-sandbox-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes and reads a file", () => {
    const dir = makeTmpDir();
    const sfs = createSandboxedFs(policy({ allowWrite: true }));
    const filePath = path.join(dir, "test.txt");

    sfs.writeFileSync(filePath, "hello world");

    expect(sfs.existsSync(filePath)).toBe(true);
    expect(sfs.readFileSync(filePath)).toBe("hello world");
  });

  it("creates nested directories on write", () => {
    const dir = makeTmpDir();
    const sfs = createSandboxedFs(policy({ allowWrite: true }));
    const filePath = path.join(dir, "a", "b", "c", "file.txt");

    sfs.writeFileSync(filePath, "deep");

    expect(sfs.readFileSync(filePath)).toBe("deep");
  });

  it("creates directories with mkdirSync", () => {
    const dir = makeTmpDir();
    const sfs = createSandboxedFs(policy({ allowWrite: true }));
    const newDir = path.join(dir, "new-dir", "sub");

    sfs.mkdirSync(newDir);

    expect(fs.existsSync(newDir)).toBe(true);
  });

  it("returns false for non-existent files", () => {
    const sfs = createSandboxedFs(policy({ allowWrite: true }));

    expect(sfs.existsSync("/nonexistent/path/file.txt")).toBe(false);
  });

  it("rejects writes when allowWrite is false", () => {
    const dir = makeTmpDir();
    const sfs = createSandboxedFs(policy({ allowWrite: false }));

    expect(() => sfs.writeFileSync(path.join(dir, "file.txt"), "data")).toThrow(
      PolicyViolationError,
    );
  });

  it("rejects writes to denied paths", () => {
    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        deniedWritePaths: ["/etc"],
      }),
    );

    expect(() => sfs.writeFileSync("/etc/passwd", "data")).toThrow(PolicyViolationError);
  });

  it("rejects writes exceeding file size limit", () => {
    const dir = makeTmpDir();
    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        maxFileSizeBytes: 10,
      }),
    );

    expect(() => sfs.writeFileSync(path.join(dir, "big.txt"), "a".repeat(100))).toThrow(
      PolicyViolationError,
    );
  });

  it("allows writes within file size limit", () => {
    const dir = makeTmpDir();
    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        maxFileSizeBytes: 1000,
      }),
    );
    const filePath = path.join(dir, "small.txt");

    sfs.writeFileSync(filePath, "ok");

    expect(sfs.readFileSync(filePath)).toBe("ok");
  });
});

describe("withTimeout", () => {
  it("resolves when promise completes within timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1000);
    expect(result).toBe("done");
  });

  it("rejects with PolicyViolationError on timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 500));

    await expect(withTimeout(slow, 50)).rejects.toThrow(PolicyViolationError);
    await expect(withTimeout(slow, 50)).rejects.toThrow("timed out");
  });

  it("propagates original error if promise rejects before timeout", async () => {
    const failing = Promise.reject(new Error("original error"));

    await expect(withTimeout(failing, 1000)).rejects.toThrow("original error");
  });
});
