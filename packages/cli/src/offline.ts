import fs from "node:fs";
import path from "node:path";

/**
 * Check if the CLI is running in offline mode.
 * Offline mode is activated by the --offline flag or DOJOPS_OFFLINE=true env var.
 */
export function isOfflineMode(): boolean {
  const envFlag = process.env.DOJOPS_OFFLINE;
  if (envFlag === "true" || envFlag === "1") return true;
  return process.argv.includes("--offline");
}

/**
 * Returns the skill cache directory path.
 */
export function skillCacheDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", "skill-cache");
}

/**
 * Copies installed hub skills to a local cache for offline use.
 * Skills are cached from both global (~/.dojops/skills/) and project (.dojops/skills/) locations.
 */
export function ensureSkillCache(rootDir: string): void {
  const cacheDir = skillCacheDir(rootDir);

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";

  // Source directories
  const sources = [path.join(home, ".dojops", "skills"), path.join(rootDir, ".dojops", "skills")];

  for (const srcDir of sources) {
    if (!fs.existsSync(srcDir)) continue;

    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".dops"));
    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const destPath = path.join(cacheDir, file);

      // Only copy if source is newer than cached version
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath);
        const destStat = fs.statSync(destPath);
        if (srcStat.mtimeMs <= destStat.mtimeMs) continue;
      }

      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Look up a skill in the offline cache.
 * Returns the file path if found, null otherwise.
 */
export function findCachedSkill(rootDir: string, skillName: string): string | null {
  const cacheDir = skillCacheDir(rootDir);
  const cachedPath = path.join(cacheDir, `${skillName}.dops`);

  if (fs.existsSync(cachedPath)) {
    return cachedPath;
  }
  return null;
}

/**
 * Export skills to a bundle directory for air-gapped environments.
 * Creates a directory with all .dops files and a manifest.json.
 */
export function exportSkillBundle(exportPath: string, rootDir: string): { count: number } {
  if (!fs.existsSync(exportPath)) {
    fs.mkdirSync(exportPath, { recursive: true });
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  const sources = [
    { dir: path.join(home, ".dojops", "skills"), scope: "global" },
    { dir: path.join(rootDir, ".dojops", "skills"), scope: "project" },
  ];

  interface ManifestEntry {
    name: string;
    scope: string;
    file: string;
  }

  const manifest: ManifestEntry[] = [];

  for (const source of sources) {
    if (!fs.existsSync(source.dir)) continue;

    const files = fs.readdirSync(source.dir).filter((f) => f.endsWith(".dops"));
    for (const file of files) {
      const srcPath = path.join(source.dir, file);
      const destPath = path.join(exportPath, file);
      fs.copyFileSync(srcPath, destPath);
      manifest.push({
        name: path.basename(file, ".dops"),
        scope: source.scope,
        file,
      });
    }
  }

  // Write manifest
  fs.writeFileSync(
    path.join(exportPath, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        skills: manifest,
      },
      null,
      2,
    ) + "\n",
    "utf-8",
  );

  return { count: manifest.length };
}

/**
 * List all cached skills in the project skill cache.
 */
export function listCachedSkills(
  rootDir: string,
): Array<{ name: string; path: string; sizeBytes: number }> {
  const cacheDir = skillCacheDir(rootDir);
  if (!fs.existsSync(cacheDir)) return [];

  return fs
    .readdirSync(cacheDir)
    .filter((f) => f.endsWith(".dops"))
    .map((f) => {
      const filePath = path.join(cacheDir, f);
      const stat = fs.statSync(filePath);
      return {
        name: f.replace(".dops", ""),
        path: filePath,
        sizeBytes: stat.size,
      };
    });
}

/**
 * Import skills from a bundle directory into the global skills directory.
 */
export function importSkillBundle(importPath: string): { count: number } {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  const destDir = path.join(home, ".dojops", "skills");

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (!fs.existsSync(importPath)) {
    throw new Error(`Import path not found: ${importPath}`);
  }

  const files = fs.readdirSync(importPath).filter((f) => f.endsWith(".dops"));
  for (const file of files) {
    const srcPath = path.join(importPath, file);
    const destPath = path.join(destDir, file);
    fs.copyFileSync(srcPath, destPath);
  }

  return { count: files.length };
}
