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
 * Searches root directory + up to 2 levels deep (supports `packages/* /` patterns).
 * Returns absolute paths of directories containing at least one indicator file.
 */
export function discoverProjectDirs(root: string, indicatorFiles: string[]): string[] {
  const results: string[] = [];

  // Check root
  if (indicatorFiles.some((f) => fs.existsSync(path.join(root, f)))) {
    results.push(root);
  }

  // Check level 1 children (e.g., enhancetech-backend/, enhancetech-frontend/)
  for (const child of listSubDirs(root)) {
    const childPath = path.join(root, child);
    if (indicatorFiles.some((f) => fs.existsSync(path.join(childPath, f)))) {
      results.push(childPath);
    }

    // Check level 2 children (e.g., packages/core/, apps/web/)
    for (const grandchild of listSubDirs(childPath)) {
      const gcPath = path.join(childPath, grandchild);
      if (indicatorFiles.some((f) => fs.existsSync(path.join(gcPath, f)))) {
        results.push(gcPath);
      }
    }
  }

  return results;
}
