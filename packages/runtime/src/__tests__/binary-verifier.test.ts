import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

import { verifyWithBinary, ALLOWED_VERIFICATION_BINARIES } from "../binary-verifier";

describe("verifyWithBinary", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  describe("E-8: network safety", () => {
    it("adds -get=false to terraform init when network permission is none", async () => {
      const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
      enoent.code = "ENOENT";
      mockExecFileSync.mockImplementation(() => {
        throw enoent;
      });

      await verifyWithBinary({
        content: 'resource "aws_s3_bucket" "b" {}',
        filename: "main.tf",
        config: {
          command: "terraform init && terraform validate -json",
          parser: "terraform-json",
          timeout: 30000,
          cwd: "output",
        },
        childProcessPermission: "required",
        networkPermission: "none",
      });

      // The first call should be "terraform" with args including "-get=false"
      expect(mockExecFileSync).toHaveBeenCalled();
      const firstCall = mockExecFileSync.mock.calls[0];
      expect(firstCall[0]).toBe("terraform");
      expect(firstCall[1]).toContain("-get=false");
    });

    it("does not add -get=false when network permission is required", async () => {
      const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
      enoent.code = "ENOENT";
      mockExecFileSync.mockImplementation(() => {
        throw enoent;
      });

      await verifyWithBinary({
        content: 'resource "aws_s3_bucket" "b" {}',
        filename: "main.tf",
        config: {
          command: "terraform init && terraform validate -json",
          parser: "terraform-json",
          timeout: 30000,
          cwd: "output",
        },
        childProcessPermission: "required",
        networkPermission: "required",
      });

      expect(mockExecFileSync).toHaveBeenCalled();
      const firstCall = mockExecFileSync.mock.calls[0];
      expect(firstCall[0]).toBe("terraform");
      expect(firstCall[1]).not.toContain("-get=false");
    });

    it("adds -get=false when network permission is absent (defaults to none)", async () => {
      const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
      enoent.code = "ENOENT";
      mockExecFileSync.mockImplementation(() => {
        throw enoent;
      });

      await verifyWithBinary({
        content: 'resource "aws_s3_bucket" "b" {}',
        filename: "main.tf",
        config: {
          command: "terraform init && terraform validate -json",
          parser: "terraform-json",
          timeout: 30000,
          cwd: "output",
        },
        childProcessPermission: "required",
        // networkPermission omitted — defaults to undefined (not "required")
      });

      expect(mockExecFileSync).toHaveBeenCalled();
      const firstCall = mockExecFileSync.mock.calls[0];
      expect(firstCall[0]).toBe("terraform");
      // When omitted, networkPermission !== "required" so -get=false should be added
      expect(firstCall[1]).toContain("-get=false");
    });
  });

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
    const enoent = new Error("ENOENT") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    mockExecFileSync.mockImplementation(() => {
      throw enoent;
    });

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
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.message.includes("not found"))).toBe(true);
  });
});

describe("ALLOWED_VERIFICATION_BINARIES whitelist sync", () => {
  it("contains all expected binaries", () => {
    const expected = [
      "terraform",
      "kubectl",
      "helm",
      "ansible-lint",
      "ansible-playbook",
      "docker",
      "hadolint",
      "yamllint",
      "jsonlint",
      "shellcheck",
      "tflint",
      "kubeval",
      "conftest",
      "checkov",
      "trivy",
      "kube-score",
      "polaris",
      "nginx",
      "promtool",
      "systemd-analyze",
      "make",
      "actionlint",
      "caddy",
      "haproxy",
      "nomad",
      "podman",
      "fluentd",
      "opa",
      "vault",
      "circleci",
      "npx",
      "tsc",
      "cfn-lint",
    ];
    for (const bin of expected) {
      expect(ALLOWED_VERIFICATION_BINARIES.has(bin)).toBe(true);
    }
    expect(ALLOWED_VERIFICATION_BINARIES.size).toBe(expected.length);
  });

  it("has exactly 33 binaries (must stay in sync with custom-tool.ts)", () => {
    // If this count changes, update ALLOWED_VERIFICATION_BINARIES in
    // packages/tool-registry/src/custom-tool.ts to match.
    expect(ALLOWED_VERIFICATION_BINARIES.size).toBe(33);
  });
});
