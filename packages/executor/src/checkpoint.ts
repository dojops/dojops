import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface CheckpointEntry {
  id: string;
  name?: string;
  stashRef: string;
  timestamp: string;
  filesTracked: string[];
}

export function checkpointsDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", "checkpoints");
}

/**
 * Create a lightweight checkpoint using `git stash create` without modifying
 * the working tree or the stash list. Returns null when there are no changes.
 */
export function createCheckpoint(rootDir: string, name?: string): CheckpointEntry | null {
  const ref = execFileSync("git", ["stash", "create"], {
    cwd: rootDir,
    encoding: "utf-8",
  }).trim();
  if (!ref) return null; // no changes to checkpoint

  // Track what files are dirty
  const status = execFileSync("git", ["diff", "--name-only"], {
    cwd: rootDir,
    encoding: "utf-8",
  }).trim();
  const files = status ? status.split("\n") : [];

  const entry: CheckpointEntry = {
    id: randomUUID().slice(0, 8),
    name,
    stashRef: ref,
    timestamp: new Date().toISOString(),
    filesTracked: files,
  };

  const dir = checkpointsDir(rootDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2) + "\n");
  return entry;
}

/**
 * Restore a checkpoint by id or name using `git stash apply`.
 */
export function restoreCheckpoint(rootDir: string, idOrName: string): CheckpointEntry | null {
  const entry = findCheckpoint(rootDir, idOrName);
  if (!entry) return null;
  execFileSync("git", ["stash", "apply", entry.stashRef], { cwd: rootDir });
  return entry;
}

/**
 * List all checkpoints, newest first.
 */
export function listCheckpoints(rootDir: string): CheckpointEntry[] {
  const dir = checkpointsDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as CheckpointEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is CheckpointEntry => e !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Remove all checkpoint metadata files. Returns the count of files removed.
 */
export function cleanCheckpoints(rootDir: string): number {
  const dir = checkpointsDir(rootDir);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) fs.unlinkSync(path.join(dir, f));
  return files.length;
}

function findCheckpoint(rootDir: string, idOrName: string): CheckpointEntry | null {
  const all = listCheckpoints(rootDir);
  return all.find((e) => e.id === idOrName || e.name === idOrName) ?? null;
}
