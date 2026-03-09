import { describe, it, expect } from "vitest";
import { runBin, runShellCmd } from "../safe-exec";

describe("safe-exec", () => {
  it("runBin executes a binary with array args", () => {
    const result = runBin("echo", ["hello", "world"], { encoding: "utf-8" });
    expect(result.toString().trim()).toBe("hello world");
  });

  it("runBin throws on non-existent binary", () => {
    expect(() => runBin("nonexistent-binary-xyz", [])).toThrow();
  });

  it("runShellCmd executes a shell command string", () => {
    const result = runShellCmd("echo test-output", { encoding: "utf-8" });
    expect(result.toString().trim()).toBe("test-output");
  });

  it("runShellCmd throws on failing command", () => {
    expect(() => runShellCmd("false")).toThrow();
  });
});
