import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createSandboxedFs, withTimeout } from "../sandbox";
import {
  PolicyViolationError,
  DEFAULT_POLICY,
  checkWriteAllowed,
  checkFileSize,
  isDevOpsFile,
  matchesAllowlistPattern,
  isPathWithin,
  filterEnvVars,
} from "../policy";
import { computeAuditHash } from "../audit";
import type { ExecutionPolicy, ExecutionAuditEntry } from "../types";

function policy(overrides: Partial<ExecutionPolicy> = {}): ExecutionPolicy {
  return { ...DEFAULT_POLICY, enforceDevOpsAllowlist: false, ...overrides };
}

// ── Critical path denylist ─────────────────────────────────────────

describe("Policy — critical path denylist (never writable)", () => {
  const writePolicy = policy({ allowWrite: true });

  it.each([
    ["/home/user/.ssh/id_rsa", "SSH private key"],
    ["/home/user/.ssh/authorized_keys", "SSH authorized keys"],
    ["/home/user/.gnupg/pubring.kbx", "GPG keyring"],
    ["/home/user/.aws/credentials", "AWS credentials"],
    ["/home/user/.aws/config", "AWS config"],
    ["/home/user/.kube/config", "Kube config"],
    ["/home/user/.docker/config.json", "Docker config"],
    ["/home/user/.npmrc", "npmrc"],
    ["/home/user/.netrc", "netrc"],
    ["/root/.ssh/id_ed25519", "root SSH key"],
  ])("blocks write to %s (%s)", (filePath) => {
    expect(() => checkWriteAllowed(filePath, writePolicy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed(filePath, writePolicy)).toThrow(
      /credential.*system.*never writable/i,
    );
  });

  it("blocks critical paths even when in allowedWritePaths", () => {
    const p = policy({
      allowWrite: true,
      allowedWritePaths: ["/home/user"],
    });
    expect(() => checkWriteAllowed("/home/user/.ssh/id_rsa", p)).toThrow(PolicyViolationError);
  });
});

// ── File size enforcement ──────────────────────────────────────────

describe("Policy — file size enforcement", () => {
  it("allows files within size limit", () => {
    expect(() => checkFileSize(100, DEFAULT_POLICY)).not.toThrow();
  });

  it("allows file at exact limit", () => {
    expect(() => checkFileSize(DEFAULT_POLICY.maxFileSizeBytes, DEFAULT_POLICY)).not.toThrow();
  });

  it("rejects file exceeding limit", () => {
    expect(() => checkFileSize(DEFAULT_POLICY.maxFileSizeBytes + 1, DEFAULT_POLICY)).toThrow(
      PolicyViolationError,
    );
  });

  it("includes size details in error", () => {
    const limit = 1024;
    const p = policy({ maxFileSizeBytes: limit });
    try {
      checkFileSize(2048, p);
      expect.fail("Should have thrown");
    } catch (e) {
      expect((e as PolicyViolationError).message).toContain("2048");
      expect((e as PolicyViolationError).message).toContain("1024");
      expect((e as PolicyViolationError).rule).toBe("maxFileSizeBytes");
    }
  });

  it("allows zero-byte files", () => {
    expect(() => checkFileSize(0, DEFAULT_POLICY)).not.toThrow();
  });
});

// ── DevOps write allowlist edge cases ──────────────────────────────

describe("Policy — DevOps allowlist edge cases", () => {
  it("rejects non-DevOps files when allowlist enforced", () => {
    const p = policy({ allowWrite: true, enforceDevOpsAllowlist: true });
    expect(() => checkWriteAllowed("/tmp/project/random.txt", p, "/tmp/project")).toThrow(
      PolicyViolationError,
    );
  });

  it("allows Dockerfile when allowlist enforced", () => {
    const p = policy({ allowWrite: true, enforceDevOpsAllowlist: true });
    expect(() => checkWriteAllowed("/tmp/project/Dockerfile", p, "/tmp/project")).not.toThrow();
  });

  it("allows .github/workflows/ when allowlist enforced", () => {
    const p = policy({ allowWrite: true, enforceDevOpsAllowlist: true });
    expect(() =>
      checkWriteAllowed("/tmp/project/.github/workflows/ci.yml", p, "/tmp/project"),
    ).not.toThrow();
  });

  it("rejects absolute path outside cwd", () => {
    expect(isDevOpsFile("/etc/Dockerfile", "/tmp/project")).toBe(false);
  });

  it("matches glob patterns correctly", () => {
    expect(matchesAllowlistPattern("Dockerfile.prod", "Dockerfile.*")).toBe(true);
    expect(matchesAllowlistPattern("docker-compose.override.yml", "docker-compose*.yml")).toBe(
      true,
    );
    expect(matchesAllowlistPattern("main.tf", "*.tf")).toBe(true);
    expect(matchesAllowlistPattern("deploy.sh", "*.sh")).toBe(true);
  });

  it("matches recursive patterns", () => {
    expect(matchesAllowlistPattern("helm/templates/deploy.yaml", "helm/**")).toBe(true);
    expect(matchesAllowlistPattern("k8s/production/deploy.yaml", "k8s/**")).toBe(true);
    expect(matchesAllowlistPattern("scripts/setup.sh", "scripts/**")).toBe(true);
  });

  it("rejects non-matching patterns", () => {
    expect(matchesAllowlistPattern("src/main.ts", "*.tf")).toBe(false);
    expect(matchesAllowlistPattern("package.json", "Dockerfile")).toBe(false);
  });
});

// ── Sandbox read policy ────────────────────────────────────────────

describe("Sandbox — read path restrictions", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("allows reads within allowedReadPaths", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-read-"));
    const filePath = path.join(tmpDir, "readable.txt");
    fs.writeFileSync(filePath, "content");

    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        allowedReadPaths: [tmpDir],
      }),
    );

    expect(sfs.readFileSync(filePath)).toBe("content");
  });

  it("blocks reads outside allowedReadPaths", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-read-"));
    const allowed = path.join(tmpDir, "allowed");
    const forbidden = path.join(tmpDir, "forbidden");
    fs.mkdirSync(allowed, { recursive: true });
    fs.mkdirSync(forbidden, { recursive: true });
    fs.writeFileSync(path.join(forbidden, "secret.txt"), "secret");

    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        allowedReadPaths: [allowed],
      }),
    );

    expect(() => sfs.readFileSync(path.join(forbidden, "secret.txt"))).toThrow(
      PolicyViolationError,
    );
  });

  it("blocks reads from deniedWritePaths", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-read-"));
    const denied = path.join(tmpDir, "denied");
    fs.mkdirSync(denied, { recursive: true });
    fs.writeFileSync(path.join(denied, "file.txt"), "denied");

    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        deniedWritePaths: [denied],
      }),
    );

    expect(() => sfs.readFileSync(path.join(denied, "file.txt"))).toThrow(PolicyViolationError);
  });

  it("throws PolicyViolationError for non-existent files", () => {
    const sfs = createSandboxedFs(policy({ allowWrite: true }));
    expect(() => sfs.readFileSync("/nonexistent/path/file.txt")).toThrow(PolicyViolationError);
    expect(() => sfs.readFileSync("/nonexistent/path/file.txt")).toThrow("File not found");
  });

  it("enforces file size limit on read", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-read-"));
    const filePath = path.join(tmpDir, "large.txt");
    fs.writeFileSync(filePath, "x".repeat(2048));

    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        maxFileSizeBytes: 1024,
      }),
    );

    expect(() => sfs.readFileSync(filePath)).toThrow(PolicyViolationError);
  });
});

// ── Sandbox write policy edge cases ────────────────────────────────

describe("Sandbox — write error paths", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects write when allowWrite is false", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-write-"));
    const sfs = createSandboxedFs(policy({ allowWrite: false }));

    expect(() => sfs.writeFileSync(path.join(tmpDir, "file.txt"), "content")).toThrow(
      PolicyViolationError,
    );
  });

  it("rejects write exceeding file size limit", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-write-"));
    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        maxFileSizeBytes: 10,
      }),
    );

    expect(() => sfs.writeFileSync(path.join(tmpDir, "big.txt"), "x".repeat(100))).toThrow(
      PolicyViolationError,
    );
  });

  it("rejects mkdir to denied path", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-write-"));
    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        deniedWritePaths: [tmpDir],
      }),
    );

    expect(() => sfs.mkdirSync(path.join(tmpDir, "blocked"))).toThrow(PolicyViolationError);
  });
});

// ── Symlink traversal prevention ───────────────────────────────────

describe("Sandbox — symlink traversal prevention", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("resolves symlink before policy check on write", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-symlink-"));
    const allowed = path.join(tmpDir, "allowed");
    const denied = path.join(tmpDir, "denied");
    fs.mkdirSync(allowed);
    fs.mkdirSync(denied);

    // Create symlink from allowed/escape -> denied/
    fs.symlinkSync(denied, path.join(allowed, "escape"));

    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        allowedWritePaths: [allowed],
      }),
    );

    // Writing through the symlink should fail because real path resolves to denied/
    expect(() => sfs.writeFileSync(path.join(allowed, "escape", "file.txt"), "payload")).toThrow(
      PolicyViolationError,
    );
  });

  it("resolves symlink before policy check on read", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-symlink-"));
    const allowed = path.join(tmpDir, "allowed");
    const denied = path.join(tmpDir, "denied");
    fs.mkdirSync(allowed);
    fs.mkdirSync(denied);
    fs.writeFileSync(path.join(denied, "secret.txt"), "top-secret");

    fs.symlinkSync(denied, path.join(allowed, "escape"));

    const sfs = createSandboxedFs(
      policy({
        allowWrite: true,
        allowedReadPaths: [allowed],
      }),
    );

    expect(() => sfs.readFileSync(path.join(allowed, "escape", "secret.txt"))).toThrow(
      PolicyViolationError,
    );
  });
});

// ── withTimeout ────────────────────────────────────────────────────

describe("withTimeout — execution timeout", () => {
  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1000);
    expect(result).toBe("done");
  });

  it("rejects with PolicyViolationError on timeout", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50)).rejects.toThrow(PolicyViolationError);
    await expect(withTimeout(slow, 50)).rejects.toThrow(/timed out/i);
  });

  it("uses custom timeout message", async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50, "Custom timeout")).rejects.toThrow("Custom timeout");
  });

  it("propagates original rejection", async () => {
    const failing = Promise.reject(new Error("Original error"));
    await expect(withTimeout(failing, 1000)).rejects.toThrow("Original error");
  });
});

// ── isPathWithin edge cases ────────────────────────────────────────

describe("isPathWithin — edge cases", () => {
  it("returns true for exact path match", () => {
    expect(isPathWithin("/home/user/project", "/home/user/project")).toBe(true);
  });

  it("returns true for file within directory", () => {
    expect(isPathWithin("/home/user/project/file.txt", "/home/user/project")).toBe(true);
  });

  it("returns false for sibling directory", () => {
    expect(isPathWithin("/home/user/other", "/home/user/project")).toBe(false);
  });

  it("returns false for partial name match (prefix attack)", () => {
    // /home/user/project-evil should NOT match /home/user/project
    expect(isPathWithin("/home/user/project-evil/file.txt", "/home/user/project")).toBe(false);
  });

  it("handles trailing separator in base", () => {
    expect(isPathWithin("/home/user/project/file.txt", "/home/user/project/")).toBe(true);
  });
});

// ── filterEnvVars ──────────────────────────────────────────────────

describe("filterEnvVars — environment variable filtering", () => {
  it("returns empty object when no vars allowed", () => {
    const result = filterEnvVars(policy({ allowEnvVars: [] }));
    expect(result).toEqual({});
  });

  it("filters to only allowed vars", () => {
    process.env.DOJOPS_TEST_VAR = "test-value";
    const result = filterEnvVars(policy({ allowEnvVars: ["DOJOPS_TEST_VAR", "NONEXISTENT"] }));
    expect(result).toEqual({ DOJOPS_TEST_VAR: "test-value" });
    delete process.env.DOJOPS_TEST_VAR;
  });
});

// ── PolicyViolationError properties ────────────────────────────────

describe("PolicyViolationError — error properties", () => {
  it("has name, message, and rule", () => {
    const err = new PolicyViolationError("Write blocked", "allowedWritePaths");
    expect(err.name).toBe("PolicyViolationError");
    expect(err.message).toBe("Write blocked");
    expect(err.rule).toBe("allowedWritePaths");
  });

  it("extends Error", () => {
    const err = new PolicyViolationError("test", "test");
    expect(err).toBeInstanceOf(Error);
  });
});

// ── Audit chain edge cases ─────────────────────────────────────────

describe("Audit chain — hash computation edge cases", () => {
  it("produces different hashes for different entries", () => {
    const e1: Partial<ExecutionAuditEntry> = { taskId: "a", skillName: "terraform" };
    const e2: Partial<ExecutionAuditEntry> = { taskId: "b", skillName: "terraform" };
    const h1 = computeAuditHash(e1 as ExecutionAuditEntry, "genesis");
    const h2 = computeAuditHash(e2 as ExecutionAuditEntry, "genesis");
    expect(h1).not.toBe(h2);
  });

  it("produces different hashes with different previous hashes", () => {
    const entry: Partial<ExecutionAuditEntry> = { taskId: "a" };
    const h1 = computeAuditHash(entry as ExecutionAuditEntry, "prev1");
    const h2 = computeAuditHash(entry as ExecutionAuditEntry, "prev2");
    expect(h1).not.toBe(h2);
  });

  it("returns 64-character hex string", () => {
    const hash = computeAuditHash({ taskId: "a" } as ExecutionAuditEntry, "genesis");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
