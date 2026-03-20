import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

const mockWriteFileSync = vi.fn();
const mockMkdtempSync = vi.fn(() => "/tmp/dojops-verify-test");
const mockRmSync = vi.fn();
const mockExistsSync = vi.fn(() => false);
const mockMkdirSync = vi.fn();
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    mkdtempSync: (...args: unknown[]) => mockMkdtempSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  };
});

import { verifyWithBinary, ALLOWED_VERIFICATION_BINARIES } from "../binary-verifier";

/** Create a NodeJS.ErrnoException with the given code. */
function makeEnoent(): NodeJS.ErrnoException {
  const err = new Error("ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

/** Terraform verify config used by multiple tests. */
const TF_VALIDATE_CONFIG = {
  command: "terraform init && terraform validate -json",
  parser: "terraform-json",
  timeout: 30000,
  cwd: "output",
} as const;

/** Common args for terraform network safety tests. */
function tfNetworkSafetyArgs(networkPermission?: string) {
  return {
    content: 'resource "aws_s3_bucket" "b" {}',
    filename: "main.tf",
    config: TF_VALIDATE_CONFIG,
    childProcessPermission: "required" as const,
    ...(networkPermission !== undefined ? { networkPermission } : {}),
  };
}

describe("verifyWithBinary", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  describe("E-8: network safety", () => {
    it.each([
      ["adds -get=false when network permission is none", "none", true],
      ["does not add -get=false when network permission is required", "required", false],
    ] as const)("%s", async (_label, networkPerm, expectGetFalse) => {
      mockExecFileSync.mockImplementation(() => {
        throw makeEnoent();
      });
      await verifyWithBinary(tfNetworkSafetyArgs(networkPerm));
      expect(mockExecFileSync).toHaveBeenCalled();
      const firstCall = mockExecFileSync.mock.calls[0];
      expect(firstCall[0]).toBe("terraform");
      if (expectGetFalse) {
        expect(firstCall[1]).toContain("-get=false");
      } else {
        expect(firstCall[1]).not.toContain("-get=false");
      }
    });

    it("adds -get=false when network permission is absent (defaults to none)", async () => {
      mockExecFileSync.mockImplementation(() => {
        throw makeEnoent();
      });
      await verifyWithBinary(tfNetworkSafetyArgs());
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
      config: TF_VALIDATE_CONFIG,
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
      config: { command: "rm -rf /", parser: "generic-stderr", timeout: 30000, cwd: "output" },
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

  it("passes when binary exits non-zero with only warnings", async () => {
    const err = new Error("exit code 1") as Error & { stdout: string; stderr: string };
    err.stdout =
      "==> Linting .\n[WARNING] templates/: directory not found\n[INFO] Chart.yaml: icon is recommended\n";
    err.stderr = "";
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });
    const result = await verifyWithBinary({
      content: "test",
      filename: "Chart.yaml",
      config: { command: "helm lint .", parser: "helm-lint", timeout: 30000, cwd: "output" },
      childProcessPermission: "required",
    });
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.severity === "warning")).toBe(true);
    expect(result.issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("passes when binary exits non-zero with empty stdout/stderr", async () => {
    const err = new Error("helm lint failed") as Error & { stdout: string; stderr: string };
    err.stdout = "";
    err.stderr = "";
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });
    const result = await verifyWithBinary({
      content: "test",
      filename: "Chart.yaml",
      config: { command: "helm lint .", parser: "helm-lint", timeout: 30000, cwd: "output" },
      childProcessPermission: "required",
    });
    // Should NOT hard-fail — parser finds no error tags, so passed is true
    expect(result.passed).toBe(true);
  });

  it("handles binary not found gracefully", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });
    const result = await verifyWithBinary({
      content: "test content",
      filename: "main.tf",
      config: TF_VALIDATE_CONFIG,
      childProcessPermission: "required",
    });
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.message.includes("not found"))).toBe(true);
  });

  it("calls onBinaryMissing callback when binary is ENOENT", async () => {
    const onBinaryMissing = vi.fn().mockResolvedValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });
    const result = await verifyWithBinary({
      content: "test content",
      filename: "playbook.yml",
      config: {
        command: "ansible-playbook --syntax-check playbook.yml",
        parser: "ansible-syntax",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
      onBinaryMissing,
    });
    expect(onBinaryMissing).toHaveBeenCalledWith("ansible-playbook");
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.message.includes("not found"))).toBe(true);
  });

  it("retries after successful auto-install via onBinaryMissing", async () => {
    let callCount = 0;
    mockExecFileSync.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        // First call: ENOENT (binary missing)
        throw makeEnoent();
      }
      // Second call (after install): success
      return '{"valid":true,"error_count":0,"diagnostics":[]}';
    });
    const onBinaryMissing = vi.fn().mockResolvedValue(true);
    const result = await verifyWithBinary({
      content: 'resource "aws_s3_bucket" "b" {}',
      filename: "main.tf",
      config: {
        command: "terraform validate -json",
        parser: "terraform-json",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
      onBinaryMissing,
    });
    expect(onBinaryMissing).toHaveBeenCalledWith("terraform");
    expect(result.passed).toBe(true);
    expect(callCount).toBe(2); // Called twice: ENOENT + retry
  });

  it("writes multiple files when files map is provided", async () => {
    mockWriteFileSync.mockClear();
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });

    await verifyWithBinary({
      content: "ignored",
      filename: "main.tf",
      config: TF_VALIDATE_CONFIG,
      childProcessPermission: "required",
      files: {
        "main.tf": 'resource "aws_instance" "web" {}',
        "variables.tf": 'variable "region" { default = "us-east-1" }',
      },
    });

    // Should write both files, not just the single content/filename
    const writeCalls = mockWriteFileSync.mock.calls;
    expect(writeCalls.length).toBe(2);
    const filenames = writeCalls.map((c: unknown[]) => String(c[0]).split("/").pop());
    expect(filenames).toContain("main.tf");
    expect(filenames).toContain("variables.tf");
    // Verify correct content was written
    const mainCall = writeCalls.find((c: unknown[]) => String(c[0]).endsWith("main.tf"));
    expect(mainCall![1]).toBe('resource "aws_instance" "web" {}');
  });

  it("creates subdirectories for nested file paths", async () => {
    mockWriteFileSync.mockClear();
    mockMkdirSync.mockClear();
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });

    const HELM_LINT_CONFIG = {
      command: "helm lint .",
      parser: "helm-lint" as const,
      timeout: 30000,
      cwd: "output",
    };

    await verifyWithBinary({
      content: "ignored",
      filename: "Chart.yaml",
      config: HELM_LINT_CONFIG,
      childProcessPermission: "required",
      files: {
        "Chart.yaml": "apiVersion: v2\nname: myapp",
        "values.yaml": "replicaCount: 1",
        "templates/deployment.yaml": "kind: Deployment",
        "templates/_helpers.tpl": '{{- define "myapp.name" -}}myapp{{- end -}}',
      },
    });

    // Should create templates/ subdirectory for nested paths
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining("templates"), {
      recursive: true,
    });
    // Should write all 4 files
    expect(mockWriteFileSync.mock.calls.length).toBe(4);
  });
});

describe("{entryFile} placeholder resolution", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("resolves {entryFile} placeholder to the actual playbook filename", async () => {
    mockWriteFileSync.mockClear();
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });

    await verifyWithBinary({
      content: "ignored",
      filename: "output",
      config: {
        command: "ansible-playbook --syntax-check {entryFile}",
        parser: "ansible-syntax",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
      files: {
        "setup-ec2.yml": "---\n- name: Setup EC2\n  hosts: all\n  tasks: []",
        "roles/setup-ec2/tasks/main.yml": "---\n- name: Install packages\n  apt:\n    name: nginx",
      },
    });

    // The command should have resolved {entryFile} to setup-ec2.yml (top-level .yml)
    expect(mockExecFileSync).toHaveBeenCalled();
    const firstCall = mockExecFileSync.mock.calls[0];
    expect(firstCall[0]).toBe("ansible-playbook");
    expect(firstCall[1]).toContain("setup-ec2.yml");
    expect(firstCall[1]).not.toContain("{entryFile}");
  });

  it("resolves {entryFile} to site.yml when present", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });

    await verifyWithBinary({
      content: "ignored",
      filename: "output",
      config: {
        command: "ansible-playbook --syntax-check {entryFile}",
        parser: "ansible-syntax",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
      files: {
        "site.yml": "---\n- import_playbook: webservers.yml",
        "webservers.yml": "---\n- hosts: web\n  tasks: []",
        "roles/common/tasks/main.yml": "---\n- name: Install\n  apt:\n    name: vim",
      },
    });

    const firstCall = mockExecFileSync.mock.calls[0];
    expect(firstCall[1]).toContain("site.yml");
  });

  it("skips verification when only inventory files are present", async () => {
    mockExecFileSync.mockReset();

    const result = await verifyWithBinary({
      content: "ignored",
      filename: "output",
      config: {
        command: "ansible-playbook --syntax-check {entryFile}",
        parser: "ansible-syntax",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
      files: {
        "ansible/inventory/hosts.yml": "all:\n  hosts:\n    web1:\n      ansible_host: 10.0.0.1",
      },
    });

    // Should skip verification entirely and return passed
    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("picks playbook over inventory when both are nested", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });

    await verifyWithBinary({
      content: "ignored",
      filename: "output",
      config: {
        command: "ansible-playbook --syntax-check {entryFile}",
        parser: "ansible-syntax",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
      files: {
        "ansible/inventory/hosts.yml": "all:\n  hosts:\n    web1:",
        "ansible/playbooks/install-nodejs.yml": "---\n- name: Install\n  hosts: all\n  tasks: []",
      },
    });

    const firstCall = mockExecFileSync.mock.calls[0];
    expect(firstCall[1]).toContain("ansible/playbooks/install-nodejs.yml");
  });

  it("falls back to filename when no {entryFile} placeholder", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw makeEnoent();
    });

    await verifyWithBinary({
      content: "test",
      filename: "main.tf",
      config: {
        command: "terraform validate -json",
        parser: "terraform-json",
        timeout: 30000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });

    // Command without {entryFile} should be unchanged
    const firstCall = mockExecFileSync.mock.calls[0];
    expect(firstCall[0]).toBe("terraform");
    expect(firstCall[1]).toEqual(["validate", "-json"]);
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
      "packer",
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

  it("has exactly 34 binaries", () => {
    expect(ALLOWED_VERIFICATION_BINARIES.size).toBe(34);
  });
});
