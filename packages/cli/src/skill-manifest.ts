import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface InstalledSkillEntry {
  name: string;
  version: string;
  source: "hub" | "local" | "built-in";
  installedAt: string;
  sha256?: string;
}

export interface SkillManifest {
  version: 1;
  updatedAt: string;
  skills: Record<string, InstalledSkillEntry>;
}

function manifestPath(scope: "global" | "project", rootDir?: string): string {
  if (scope === "global") {
    return path.join(os.homedir(), ".dojops", "skill-manifest.json");
  }
  const root = rootDir ?? process.cwd();
  return path.join(root, ".dojops", "skill-manifest.json");
}

export function loadManifest(scope: "global" | "project", rootDir?: string): SkillManifest {
  const filePath = manifestPath(scope, rootDir);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    if (data.version === 1) return data as SkillManifest;
  } catch {
    // Missing or corrupt — return empty
  }
  return { version: 1, updatedAt: new Date().toISOString(), skills: {} };
}

export function saveManifest(
  manifest: SkillManifest,
  scope: "global" | "project",
  rootDir?: string,
): void {
  const filePath = manifestPath(scope, rootDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n");
}

export function recordInstall(
  scope: "global" | "project",
  entry: InstalledSkillEntry,
  rootDir?: string,
): void {
  const manifest = loadManifest(scope, rootDir);
  manifest.skills[entry.name] = entry;
  saveManifest(manifest, scope, rootDir);
}

export function getInstalledVersion(
  skillName: string,
  scope: "global" | "project",
  rootDir?: string,
): string | null {
  const manifest = loadManifest(scope, rootDir);
  return manifest.skills[skillName]?.version ?? null;
}

export function listInstalledSkills(
  scope: "global" | "project",
  rootDir?: string,
): InstalledSkillEntry[] {
  const manifest = loadManifest(scope, rootDir);
  return Object.values(manifest.skills);
}

/** Compare local manifest versions against remote hub versions. */
export async function checkForUpdates(
  scope: "global" | "project",
  hubUrl: string,
  rootDir?: string,
): Promise<Array<{ name: string; currentVersion: string; latestVersion: string }>> {
  const manifest = loadManifest(scope, rootDir);
  const hubSkills = Object.values(manifest.skills).filter((s) => s.source === "hub");

  const updates: Array<{ name: string; currentVersion: string; latestVersion: string }> = [];

  for (const skill of hubSkills) {
    try {
      const resp = await fetch(`${hubUrl}/api/skills/${skill.name}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as { version?: string };
      if (data.version && data.version !== skill.version) {
        updates.push({
          name: skill.name,
          currentVersion: skill.version,
          latestVersion: data.version,
        });
      }
    } catch {
      // Skip unreachable skills
    }
  }

  return updates;
}
