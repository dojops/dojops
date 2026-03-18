import fs from "node:fs";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────

export interface RunMeta {
  id: string;
  prompt: string;
  status: "running" | "completed" | "failed";
  pid: number;
  startedAt: string;
  completedAt?: string;
}

export interface RunResult {
  success: boolean;
  summary: string;
  iterations: number;
  toolCalls: number;
  totalTokens: number;
  filesWritten: string[];
  filesModified: string[];
}

// ── Paths ──────────────────────────────────────────────────────────

const RUNS_DIR = "runs";

export function runsDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", RUNS_DIR);
}

export function runDir(rootDir: string, id: string): string {
  return path.join(runsDir(rootDir), id);
}

function metaPath(rootDir: string, id: string): string {
  return path.join(runDir(rootDir, id), "meta.json");
}

function resultPath(rootDir: string, id: string): string {
  return path.join(runDir(rootDir, id), "result.json");
}

export function outputLogPath(rootDir: string, id: string): string {
  return path.join(runDir(rootDir, id), "output.log");
}

// ── Write ──────────────────────────────────────────────────────────

export function writeRunMeta(rootDir: string, meta: RunMeta): void {
  const dir = runDir(rootDir, meta.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath(rootDir, meta.id), JSON.stringify(meta, null, 2));
}

export function writeRunResult(rootDir: string, id: string, result: RunResult): void {
  fs.writeFileSync(resultPath(rootDir, id), JSON.stringify(result, null, 2));
}

export function updateRunStatus(rootDir: string, id: string, status: "completed" | "failed"): void {
  const meta = readRunMeta(rootDir, id);
  if (!meta) return;
  meta.status = status;
  meta.completedAt = new Date().toISOString();
  fs.writeFileSync(metaPath(rootDir, id), JSON.stringify(meta, null, 2));
}

// ── Read ───────────────────────────────────────────────────────────

export function readRunMeta(rootDir: string, id: string): RunMeta | null {
  try {
    const raw = fs.readFileSync(metaPath(rootDir, id), "utf8");
    return JSON.parse(raw) as RunMeta;
  } catch {
    return null;
  }
}

export function readRunResult(rootDir: string, id: string): RunResult | null {
  try {
    const raw = fs.readFileSync(resultPath(rootDir, id), "utf8");
    return JSON.parse(raw) as RunResult;
  } catch {
    return null;
  }
}

export function listRuns(rootDir: string): RunMeta[] {
  const dir = runsDir(rootDir);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const metas: RunMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = readRunMeta(rootDir, entry.name);
    if (meta) {
      // Check if a "running" process is actually still alive
      if (meta.status === "running" && meta.pid > 0) {
        try {
          process.kill(meta.pid, 0);
        } catch {
          // Process no longer alive — mark as failed
          meta.status = "failed";
          meta.completedAt = new Date().toISOString();
          try {
            fs.writeFileSync(metaPath(rootDir, meta.id), JSON.stringify(meta, null, 2));
          } catch {
            /* best-effort */
          }
        }
      }
      metas.push(meta);
    }
  }

  // Sort by startedAt descending (most recent first)
  metas.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return metas;
}

/**
 * Remove completed/failed runs older than maxAgeDays.
 * Returns the number of runs removed.
 */
export function cleanOldRuns(rootDir: string, maxAgeDays = 7): number {
  const runs = listRuns(rootDir);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const meta of runs) {
    if (meta.status === "running") continue;
    const ts = meta.completedAt ?? meta.startedAt;
    if (new Date(ts).getTime() < cutoff) {
      try {
        fs.rmSync(runDir(rootDir, meta.id), { recursive: true, force: true });
        removed++;
      } catch {
        /* best-effort */
      }
    }
  }

  return removed;
}
