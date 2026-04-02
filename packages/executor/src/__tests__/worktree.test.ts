import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateWorktreeSlug,
  findGitRoot,
  createWorktree,
  removeWorktree,
  listWorktrees,
} from "../worktree";

// ── validateWorktreeSlug ────────────────────────────────────────

describe("validateWorktreeSlug", () => {
  it("accepts valid alphanumeric slugs", () => {
    expect(validateWorktreeSlug("dojops-abc123")).toBe(true);
    expect(validateWorktreeSlug("my.slug")).toBe(true);
    expect(validateWorktreeSlug("a_b-c.d")).toBe(true);
    expect(validateWorktreeSlug("simple")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateWorktreeSlug("")).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(validateWorktreeSlug("..")).toBe(false);
    expect(validateWorktreeSlug("../evil")).toBe(false);
    expect(validateWorktreeSlug("foo/../bar")).toBe(false);
  });

  it("rejects strings longer than 64 characters", () => {
    expect(validateWorktreeSlug("a".repeat(65))).toBe(false);
    expect(validateWorktreeSlug("a".repeat(64))).toBe(true);
  });

  it("rejects slugs with spaces or special characters", () => {
    expect(validateWorktreeSlug("has space")).toBe(false);
    expect(validateWorktreeSlug("has/slash")).toBe(false);
    expect(validateWorktreeSlug("has@at")).toBe(false);
    expect(validateWorktreeSlug("has$dollar")).toBe(false);
  });
});

// ── findGitRoot ─────────────────────────────────────────────────

describe("findGitRoot", () => {
  it("returns null for non-git directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "worktree-test-"));
    try {
      expect(findGitRoot(tmp)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns the git root for a git repository", () => {
    const tmp = mkdtempSync(join(tmpdir(), "worktree-test-"));
    try {
      execFileSync("git", ["init"], { cwd: tmp, stdio: "pipe" });
      const root = findGitRoot(tmp);
      expect(root).toBeTruthy();
      // The returned path should end with the temp dir name (realpath may differ)
      expect(root).toContain("worktree-test-");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── listWorktrees ───────────────────────────────────────────────

describe("listWorktrees", () => {
  it("returns empty array for non-git directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "worktree-test-"));
    try {
      expect(listWorktrees(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns empty array when no .dojops/worktrees exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "worktree-test-"));
    try {
      execFileSync("git", ["init"], { cwd: tmp, stdio: "pipe" });
      expect(listWorktrees(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── createWorktree / removeWorktree ─────────────────────────────

describe("createWorktree + removeWorktree", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "worktree-test-"));
    // Init a git repo with at least one commit (worktrees need a HEAD)
    execFileSync("git", ["init"], { cwd: tmp, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmp, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmp, stdio: "pipe" });
    writeFileSync(join(tmp, "README.md"), "# test\n");
    execFileSync("git", ["add", "."], { cwd: tmp, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: tmp, stdio: "pipe" });
  });

  afterEach(() => {
    // Clean up any worktrees first to avoid git lock issues
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: tmp, stdio: "pipe" });
    } catch {
      // Ignore
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws when not in a git repository", () => {
    const nonGit = mkdtempSync(join(tmpdir(), "worktree-test-nogit-"));
    try {
      expect(() => createWorktree({ cwd: nonGit })).toThrow("Not a git repository");
    } finally {
      rmSync(nonGit, { recursive: true, force: true });
    }
  });

  it("throws on invalid slug", () => {
    expect(() => createWorktree({ cwd: tmp, slug: "../evil" })).toThrow("Invalid worktree slug");
  });

  it("creates a worktree and cleans it up", () => {
    const session = createWorktree({ cwd: tmp, slug: "test-wt" });

    expect(session.owned).toBe(true);
    expect(session.branch).toBe("worktree-test-wt");
    expect(session.originalCwd).toBe(tmp);
    expect(existsSync(session.worktreePath)).toBe(true);
    // The worktree should contain the README from the original repo
    expect(existsSync(join(session.worktreePath, "README.md"))).toBe(true);

    // Clean up
    removeWorktree(session);
    expect(existsSync(session.worktreePath)).toBe(false);
  });

  it("reuses an existing worktree (owned=false)", () => {
    const session1 = createWorktree({ cwd: tmp, slug: "reuse-wt" });
    expect(session1.owned).toBe(true);

    // Creating again with the same slug should reuse
    const session2 = createWorktree({ cwd: tmp, slug: "reuse-wt" });
    expect(session2.owned).toBe(false);
    expect(session2.worktreePath).toBe(session1.worktreePath);

    // removeWorktree with owned=false should be a no-op
    removeWorktree(session2);
    expect(existsSync(session1.worktreePath)).toBe(true);

    // Clean up the owned session
    removeWorktree(session1);
  });

  it("generates a random slug when none is provided", () => {
    const session = createWorktree({ cwd: tmp });

    expect(session.owned).toBe(true);
    expect(session.branch).toMatch(/^worktree-dojops-[a-f0-9]{8}$/);
    expect(existsSync(session.worktreePath)).toBe(true);

    removeWorktree(session);
  });

  it("removeWorktree is a no-op for non-owned sessions", () => {
    const session: Parameters<typeof removeWorktree>[0] = {
      originalCwd: tmp,
      worktreePath: join(tmp, ".dojops", "worktrees", "fake"),
      branch: "fake-branch",
      owned: false,
    };

    // Should not throw
    removeWorktree(session);
  });
});
