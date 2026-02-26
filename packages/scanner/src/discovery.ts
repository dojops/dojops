import * as fs from "node:fs";
import * as path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".dojops",
  "dist",
  "build",
  "__pycache__",
  ".next",
  ".cache",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  ".tox",
  "target",
]);

/**
 * List immediate child directories, skipping noise directories and dotfiles.
 */
export function listSubDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_DIRS.has(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Discover sub-project directories that contain any of the given indicator files.
 * Searches root directory + up to 3 levels deep (supports nested monorepos like
 * `packages/core/`, `apps/web/`, or `services/api/modules/auth/`).
 * Returns absolute paths of directories containing at least one indicator file.
 */
export function discoverProjectDirs(
  root: string,
  indicatorFiles: string[],
  maxDepth = 3,
): string[] {
  const results: string[] = [];

  function scanLevel(dir: string, depth: number): void {
    if (indicatorFiles.some((f) => fs.existsSync(path.join(dir, f)))) {
      results.push(dir);
    }
    if (depth >= maxDepth) return;
    for (const child of listSubDirs(dir)) {
      scanLevel(path.join(dir, child), depth + 1);
    }
  }

  scanLevel(root, 0);
  return results;
}
