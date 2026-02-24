import { describe, it, expect } from "vitest";
import {
  checkWriteAllowed,
  checkFileSize,
  filterEnvVars,
  PolicyViolationError,
  DEFAULT_POLICY,
} from "./policy";
import { ExecutionPolicy } from "./types";

describe("checkWriteAllowed", () => {
  it("throws when allowWrite is false", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, allowWrite: false };
    expect(() => checkWriteAllowed("/tmp/file.txt", policy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed("/tmp/file.txt", policy)).toThrow("not allowed by policy");
  });

  it("allows write when allowWrite is true and no path restrictions", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, allowWrite: true };
    expect(() => checkWriteAllowed("/tmp/file.txt", policy)).not.toThrow();
  });

  it("denies write to denied paths", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      deniedWritePaths: ["/etc"],
    };
    expect(() => checkWriteAllowed("/etc/passwd", policy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed("/etc/passwd", policy)).toThrow("denied by policy");
  });

  it("allows write only to allowed paths when specified", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      allowedWritePaths: ["/tmp/project"],
    };
    expect(() => checkWriteAllowed("/tmp/project/file.txt", policy)).not.toThrow();
    expect(() => checkWriteAllowed("/home/user/file.txt", policy)).toThrow(PolicyViolationError);
  });

  it("denied paths take priority over allowed paths", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      allowedWritePaths: ["/tmp"],
      deniedWritePaths: ["/tmp/secret"],
    };
    expect(() => checkWriteAllowed("/tmp/ok.txt", policy)).not.toThrow();
    expect(() => checkWriteAllowed("/tmp/secret/key", policy)).toThrow(PolicyViolationError);
  });
});

describe("checkFileSize", () => {
  it("allows files within limit", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, maxFileSizeBytes: 1024 };
    expect(() => checkFileSize(500, policy)).not.toThrow();
  });

  it("rejects files exceeding limit", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, maxFileSizeBytes: 1024 };
    expect(() => checkFileSize(2048, policy)).toThrow(PolicyViolationError);
    expect(() => checkFileSize(2048, policy)).toThrow("exceeds limit");
  });
});

describe("filterEnvVars", () => {
  it("returns empty object when no env vars allowed", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, allowEnvVars: [] };
    const result = filterEnvVars(policy);
    expect(result).toEqual({});
  });

  it("filters to only allowed env vars", () => {
    process.env.DOJOPS_TEST_VAR = "test_value";
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowEnvVars: ["DOJOPS_TEST_VAR", "NONEXISTENT"],
    };
    const result = filterEnvVars(policy);
    expect(result).toEqual({ DOJOPS_TEST_VAR: "test_value" });
    delete process.env.DOJOPS_TEST_VAR;
  });
});
