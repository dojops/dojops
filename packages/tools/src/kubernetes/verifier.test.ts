import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyKubernetesYaml } from "./verifier";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdtempSync: vi.fn(() => "/tmp/dojops-kubectl-mock"),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { execFileSync } from "node:child_process";

const mockExecFileSync = vi.mocked(execFileSync);

describe("verifyKubernetesYaml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns passed for valid manifest", async () => {
    mockExecFileSync.mockReturnValue("deployment.apps/myapp created (dry run)");

    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp`;

    const result = await verifyKubernetesYaml(yaml);

    expect(result.passed).toBe(true);
    expect(result.tool).toBe("kubectl dry-run");
    expect(result.issues).toHaveLength(0);
  });

  it("returns failed with errors for invalid manifest", async () => {
    const err = new Error("exit 1") as Error & { stderr: string };
    (err as NodeJS.ErrnoException).code = undefined;
    (err as Error & { stderr: string }).stderr =
      'error: error validating data: ValidationError(Deployment.spec): missing required field "selector"';
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });

    const result = await verifyKubernetesYaml("apiVersion: apps/v1\nkind: Deployment");

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].severity).toBe("error");
    expect(result.issues[0].message).toContain("selector");
  });

  it("returns passed with warning when kubectl is not found", async () => {
    const err = new Error("spawn kubectl ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileSync.mockImplementation(() => {
      throw err;
    });

    const result = await verifyKubernetesYaml("apiVersion: v1\nkind: Service");

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].severity).toBe("warning");
    expect(result.issues[0].message).toContain("kubectl not found");
  });
});
