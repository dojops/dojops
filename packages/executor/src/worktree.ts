/**
 * Git worktree management for isolated agent execution.
 * Creates temporary worktrees so agent operations don't affect the user's working tree.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";

export interface WorktreeSession {
  /** Original working directory. */
  originalCwd: string;
  /** Path to the worktree directory. */
  worktreePath: string;
  /** Branch name created for the worktree. */
  branch: string;
  /** Whether this session owns the worktree (for cleanup). */
  owned: boolean;
}

/**
 * Find the git root directory by walking up from cwd.
 */
export function findGitRoot(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Validate a worktree slug to prevent path traversal.
 */
export function validateWorktreeSlug(slug: string): boolean {
  if (!slug || slug.length > 64) return false;
  if (slug.includes("..")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(slug);
}

/**
 * Create or reuse a git worktree for isolated execution.
 * Returns a WorktreeSession with the worktree path.
 */
export function createWorktree(opts: {
  cwd: string;
  slug?: string;
  branch?: string;
}): WorktreeSession {
  const gitRoot = findGitRoot(opts.cwd);
  if (!gitRoot) {
    throw new Error("Not a git repository — cannot create worktree");
  }

  const slug = opts.slug ?? `dojops-${crypto.randomBytes(4).toString("hex")}`;
  if (!validateWorktreeSlug(slug)) {
    throw new Error(`Invalid worktree slug: ${slug}`);
  }

  const worktreeDir = join(gitRoot, ".dojops", "worktrees");
  const worktreePath = join(worktreeDir, slug);
  const branch = opts.branch ?? `worktree-${slug}`;

  // Reuse if already exists and is valid
  if (existsSync(join(worktreePath, ".git"))) {
    return {
      originalCwd: opts.cwd,
      worktreePath: realpathSync(worktreePath),
      branch,
      owned: false,
    };
  }

  // Ensure parent directory exists
  mkdirSync(worktreeDir, { recursive: true });

  // Get current HEAD
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: gitRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  // Create worktree with new branch from current HEAD
  try {
    execFileSync("git", ["worktree", "add", "-b", branch, worktreePath, head], {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Branch may already exist — try without -b
    try {
      execFileSync("git", ["worktree", "add", worktreePath, head, "--detach"], {
        cwd: gitRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (innerErr) {
      throw new Error(`Failed to create worktree: ${innerErr}`, { cause: innerErr });
    }
  }

  // Symlink node_modules if it exists (avoid reinstalling dependencies)
  const nodeModules = join(gitRoot, "node_modules");
  const targetModules = join(worktreePath, "node_modules");
  if (existsSync(nodeModules) && !existsSync(targetModules)) {
    try {
      symlinkSync(nodeModules, targetModules, "junction");
    } catch {
      // Symlink failure is non-fatal
    }
  }

  // Also symlink .dojops directory (config, sessions, etc.)
  const dojopsDir = join(gitRoot, ".dojops");
  const targetDojops = join(worktreePath, ".dojops");
  if (!existsSync(targetDojops)) {
    try {
      symlinkSync(dojopsDir, targetDojops, "junction");
    } catch {
      // Non-fatal
    }
  }

  return {
    originalCwd: opts.cwd,
    worktreePath: realpathSync(worktreePath),
    branch,
    owned: true,
  };
}

/**
 * Remove a worktree and its branch.
 * Only removes if the session owns it (was created by us).
 */
export function removeWorktree(session: WorktreeSession): void {
  if (!session.owned) return;

  const gitRoot = findGitRoot(session.originalCwd);
  if (!gitRoot) return;

  try {
    // Remove the worktree
    execFileSync("git", ["worktree", "remove", session.worktreePath, "--force"], {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Force cleanup if git worktree remove fails
    try {
      rmSync(session.worktreePath, { recursive: true, force: true });
      execFileSync("git", ["worktree", "prune"], {
        cwd: gitRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Best effort
    }
  }

  // Try to delete the branch
  try {
    execFileSync("git", ["branch", "-D", session.branch], {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Branch may not exist or be checked out elsewhere
  }
}

/**
 * List existing dojops worktrees.
 */
export function listWorktrees(cwd: string): WorktreeSession[] {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) return [];

  const worktreeDir = join(gitRoot, ".dojops", "worktrees");
  if (!existsSync(worktreeDir)) return [];

  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: gitRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const sessions: WorktreeSession[] = [];
    const entries = output.split("\n\n").filter(Boolean);

    for (const entry of entries) {
      const lines = entry.split("\n");
      const pathLine = lines.find((l) => l.startsWith("worktree "));
      const branchLine = lines.find((l) => l.startsWith("branch "));

      if (pathLine) {
        const wtPath = pathLine.slice("worktree ".length);
        if (wtPath.includes(".dojops/worktrees/")) {
          sessions.push({
            originalCwd: gitRoot,
            worktreePath: wtPath,
            branch: branchLine ? branchLine.slice("branch refs/heads/".length) : "",
            owned: true,
          });
        }
      }
    }

    return sessions;
  } catch {
    return [];
  }
}
