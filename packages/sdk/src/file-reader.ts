import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const MAX_CONTENT_SIZE = 50 * 1024; // 50 KB

export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* .tmp already gone */
    }
    throw err;
  }
}

/**
 * Restore a backup file. By default restores the latest `.bak`.
 * If `level` is specified (0 = latest versioned, 1 = previous, etc.),
 * restores from the versioned backup chain.
 */
export function restoreBackup(filePath: string, level?: number): boolean {
  let bakPath: string;

  if (level === undefined) {
    bakPath = `${filePath}.bak`;
  } else {
    // Restore from versioned backup chain
    const backups = listBackups(filePath);
    if (level >= backups.length) return false;
    bakPath = backups[level];
  }

  if (!fs.existsSync(bakPath)) return false;
  // Reject symlinks to prevent overwriting arbitrary targets
  try {
    const bakStat = fs.lstatSync(bakPath);
    if (bakStat.isSymbolicLink()) {
      throw new Error(`Refusing to restore symlinked backup: ${bakPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  try {
    fs.renameSync(bakPath, filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      fs.copyFileSync(bakPath, filePath);
      fs.unlinkSync(bakPath);
    } else {
      throw err;
    }
  }
  return true;
}

export function readExistingConfig(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_SIZE) return null;
    return content;
  } catch {
    return null;
  }
}

/**
 * Create a backup of a file before overwriting.
 * Uses timestamped naming (`.bak.{timestamp}`) for multi-level rollback support.
 * Also maintains a `.bak` symlink/copy pointing to the latest backup for backward compatibility.
 */
export function backupFile(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to backup symlink: ${filePath}`);
    }
    if (!stat.isFile()) return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  // Create timestamped backup for multi-level support
  const timestamp = Date.now();
  const versionedPath = `${filePath}.bak.${timestamp}`;
  fs.copyFileSync(filePath, versionedPath);
  // Atomic update of `.bak` as latest backup for backward compat
  const tmpBak = `${filePath}.bak.tmp`;
  fs.copyFileSync(filePath, tmpBak);
  fs.renameSync(tmpBak, `${filePath}.bak`);
}

/**
 * List all versioned backups for a file, sorted newest first.
 */
export function listBackups(filePath: string): string[] {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${base}.bak.`) && /\.\d+$/.test(f))
      .sort((a, b) => {
        const tsA = Number.parseInt(a.match(/\.(\d+)$/)?.[1] ?? "0", 10);
        const tsB = Number.parseInt(b.match(/\.(\d+)$/)?.[1] ?? "0", 10);
        return tsB - tsA; // newest first
      })
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
