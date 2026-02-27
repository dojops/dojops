import { describe, it, expect } from "vitest";
import { verifyWithBinary } from "../binary-verifier";

describe("verifyWithBinary", () => {
  it("skips when child_process permission is not required", async () => {
    const result = await verifyWithBinary({
      content: "test content",
      filename: "test.tf",
      config: {
        command: "terraform validate -json",
        parser: "terraform-json",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "none",
    });
    expect(result.passed).toBe(true);
    expect(result.issues[0].severity).toBe("info");
    expect(result.issues[0].message).toContain("skipped");
  });

  it("rejects non-whitelisted commands", async () => {
    const result = await verifyWithBinary({
      content: "test",
      filename: "test.txt",
      config: {
        command: "rm -rf /",
        parser: "generic-stderr",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
    expect(result.passed).toBe(false);
    expect(result.issues[0].message).toContain("not allowed");
  });

  it("returns error for unknown parser", async () => {
    const result = await verifyWithBinary({
      content: "test",
      filename: "test.txt",
      config: {
        command: "terraform validate",
        parser: "nonexistent-parser",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
    expect(result.passed).toBe(false);
    expect(result.issues[0].message).toContain("Unknown verification parser");
  });

  it("handles binary not found gracefully", async () => {
    const result = await verifyWithBinary({
      content: "test content",
      filename: "main.tf",
      config: {
        command: "terraform validate -json",
        parser: "terraform-json",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
    // terraform likely not installed in test env
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.message.includes("not found"))).toBe(true);
  });
});
