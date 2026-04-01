import * as fs from "node:fs";
import * as path from "node:path";
import type { PackManifest, InstalledPack } from "./pack-types";
import type { DopsFileEntry } from "./dops-loader";
import type { CustomAgentEntry } from "./agent-loader";
import { parseAgentReadme } from "./agent-parser";

const PACKS_DIR_NAME = "packs";
const MANIFEST_FILE = "pack.json";
const README_FILE = "README.md";
const MAX_README_SIZE = 65_536;

function getGlobalPacksDir(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, ".dojops", PACKS_DIR_NAME);
}

function getProjectPacksDir(projectPath: string): string {
  return path.join(projectPath, ".dojops", PACKS_DIR_NAME);
}

/**
 * Parse and validate a pack.json manifest file.
 * Returns null if the file is invalid or missing required fields.
 */
export function parsePackManifest(manifestPath: string): PackManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const data = JSON.parse(raw);

    if (!data.packVersion || !data.name || !data.description || !data.version) {
      return null;
    }
    if (!Array.isArray(data.skills)) data.skills = [];
    if (!Array.isArray(data.agents)) data.agents = [];

    return data as PackManifest;
  } catch {
    return null;
  }
}

/**
 * Load a single pack from its directory.
 */
function loadPack(packDir: string, location: "global" | "project"): InstalledPack | null {
  const manifestPath = path.join(packDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = parsePackManifest(manifestPath);
  if (!manifest) return null;

  return { manifest, packDir, location };
}

/**
 * Scan a directory for pack subdirectories.
 */
function loadPacksFromDirectory(
  baseDir: string,
  location: "global" | "project",
  packs: Map<string, InstalledPack>,
): void {
  if (!fs.existsSync(baseDir)) return;
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pack = loadPack(path.join(baseDir, entry.name), location);
      if (pack) packs.set(pack.manifest.name, pack);
    }
  } catch {
    // Silently skip unreadable directory
  }
}

/**
 * Discover all installed packs from global and project directories.
 * Project packs override global packs by name.
 */
export function discoverPacks(projectPath?: string): InstalledPack[] {
  const packs = new Map<string, InstalledPack>();

  const globalDir = getGlobalPacksDir();
  if (globalDir) loadPacksFromDirectory(globalDir, "global", packs);

  if (projectPath) {
    loadPacksFromDirectory(getProjectPacksDir(projectPath), "project", packs);
  }

  return Array.from(packs.values());
}

/**
 * Extract .dops file entries from installed packs.
 * Each skill path in the manifest is resolved relative to the pack directory.
 */
export function getPackSkillEntries(packs: InstalledPack[]): DopsFileEntry[] {
  const entries: DopsFileEntry[] = [];

  for (const pack of packs) {
    for (const skillPath of pack.manifest.skills) {
      const fullPath = path.resolve(pack.packDir, skillPath);
      if (fs.existsSync(fullPath) && fullPath.endsWith(".dops")) {
        entries.push({ filePath: fullPath, location: pack.location });
      }
    }
  }

  return entries;
}

/**
 * Extract custom agent entries from installed packs.
 * Each agent path in the manifest points to a directory containing a README.md.
 */
export function getPackAgentEntries(packs: InstalledPack[]): CustomAgentEntry[] {
  const entries: CustomAgentEntry[] = [];

  for (const pack of packs) {
    for (const agentPath of pack.manifest.agents) {
      const agentDir = path.resolve(pack.packDir, agentPath);
      const readmePath = path.join(agentDir, README_FILE);
      if (!fs.existsSync(readmePath)) continue;

      try {
        const stat = fs.statSync(readmePath);
        if (stat.size > MAX_README_SIZE) continue;
        const content = fs.readFileSync(readmePath, "utf-8");
        const dirName = path.basename(agentDir);
        const config = parseAgentReadme(content, dirName);
        if (config) {
          entries.push({ config, agentDir, location: pack.location });
        }
      } catch {
        // Skip unreadable agent
      }
    }
  }

  return entries;
}
