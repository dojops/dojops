import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyTerraformHcl } from "./verifier";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdtempSync: vi.fn(() => "/tmp/oda-tf-mock"),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { execFileSync } from "node:child_process";

const mockExecFileSync = vi.mocked(execFileSync);

describe("verifyTerraformHcl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed when terraform reports valid", async () => {
    // init call succeeds
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.some((a) => a === "init")) return "";
      // validate call
      return JSON.stringify({
        valid: true,
        diagnostics: [],
      });
    });

    const result = await verifyTerraformHcl('resource "aws_s3_bucket" "b" {}');

    expect(result.passed).toBe(true);
    expect(result.tool).toBe("terraform validate");
    expect(result.issues).toHaveLength(0);
  });

  it("returns failed with error issues for invalid HCL", async () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      const argsArr = args as string[];
      if (argsArr.some((a) => a === "init")) return "";
      // validate exits non-zero — simulate by throwing with stdout
      const err = new Error("exit code 1") as Error & { stdout: string };
      err.stdout = JSON.stringify({
        valid: false,
        diagnostics: [
          {
            severity: "error",
            summary: "Unsupported block type",
            detail: 'Blocks of type "invalid" are not expected here.',
          },
        ],
      });
      throw err;
    });

    const result = await verifyTerraformHcl("invalid {}");

    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("error");
    expect(result.issues[0].message).toContain("Unsupported block type");
  });

  it("returns passed with warning when terraform is not found", async () => {
    const err = new Error("spawn terraform ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });

    const result = await verifyTerraformHcl('resource "aws_s3_bucket" "b" {}');

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("warning");
    expect(result.issues[0].message).toContain("terraform not found");
  });
});
