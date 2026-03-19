import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { discoverUserDopsFiles } from "@dojops/skill-registry";
import { parseDopsFile } from "@dojops/runtime";
import { CommandHandler } from "../types";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { hasFlag } from "../parser";
import { findProjectRoot } from "../state";
import { exportSkillBundle, importSkillBundle } from "../offline";

const DEFAULT_HUB_URL = process.env.DOJOPS_HUB_URL || "https://hub.dojops.ai";

interface InstalledSkill {
  name: string;
  version: string;
  filePath: string;
  location: string;
}

interface HubVersionInfo {
  semver: string;
}

interface HubPackageInfo {
  latestVersion?: HubVersionInfo;
}

function discoverInstalledSkills(): InstalledSkill[] {
  const projectRoot = findProjectRoot() ?? undefined;
  const dopsFiles = discoverUserDopsFiles(projectRoot);
  const skills: InstalledSkill[] = [];

  for (const entry of dopsFiles) {
    try {
      const skill = parseDopsFile(entry.filePath);
      skills.push({
        name: skill.frontmatter.meta.name,
        version: skill.frontmatter.meta.version,
        filePath: entry.filePath,
        location: entry.location,
      });
    } catch {
      // Skip invalid .dops files
    }
  }

  return skills;
}

async function checkHubVersion(skillName: string): Promise<string | null> {
  const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  try {
    const res = await fetch(`${DEFAULT_HUB_URL}/api/packages/${slug}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HubPackageInfo;
    return data.latestVersion?.semver ?? null;
  } catch {
    return null;
  }
}

function compareVersions(current: string, latest: string): boolean {
  // Simple semver comparison: returns true if latest > current
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

/**
 * `dojops skills update [name]` — checks the Hub for newer versions of installed skills.
 */
export const skillsUpdateCommand: CommandHandler = async (args, ctx) => {
  const targetName = args.find((a) => !a.startsWith("-"));
  const autoInstall = hasFlag(args, "--yes") || ctx.globalOpts.nonInteractive;
  const isJson = ctx.globalOpts.output === "json";

  const skills = discoverInstalledSkills();
  if (skills.length === 0) {
    if (isJson) {
      console.log(JSON.stringify([]));
    } else {
      p.log.info("No custom skills installed.");
    }
    return;
  }

  const toCheck = targetName ? skills.filter((s) => s.name === targetName) : skills;

  if (toCheck.length === 0) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Skill "${targetName}" not found among installed skills.`,
    );
  }

  const spinner = p.spinner();
  if (!isJson) spinner.start("Checking hub for updates...");

  interface UpdateInfo {
    name: string;
    currentVersion: string;
    latestVersion: string;
    location: string;
    filePath: string;
    updateAvailable: boolean;
  }

  const updates: UpdateInfo[] = [];
  for (const skill of toCheck) {
    const latest = await checkHubVersion(skill.name);
    if (latest) {
      updates.push({
        name: skill.name,
        currentVersion: skill.version,
        latestVersion: latest,
        location: skill.location,
        filePath: skill.filePath,
        updateAvailable: compareVersions(skill.version, latest),
      });
    }
  }

  if (!isJson) spinner.stop("Update check complete");

  const available = updates.filter((u) => u.updateAvailable);

  if (isJson) {
    console.log(JSON.stringify(updates, null, 2));
    return;
  }

  if (available.length === 0) {
    p.log.success("All skills are up to date.");
    return;
  }

  const lines = available.map(
    (u) =>
      `  ${pc.cyan(u.name.padEnd(25))} ${pc.dim(`v${u.currentVersion}`)} ${pc.dim("->")} ${pc.green(`v${u.latestVersion}`)}  ${pc.dim(`(${u.location})`)}`,
  );
  p.note(lines.join("\n"), `Updates Available (${available.length})`);

  if (autoInstall) {
    for (const update of available) {
      const slug = update.name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      try {
        const res = await fetch(`${DEFAULT_HUB_URL}/api/download/${slug}/${update.latestVersion}`);
        if (res.ok) {
          const fileBuffer = Buffer.from(await res.arrayBuffer());
          const checksum = res.headers.get("x-checksum-sha256");
          if (checksum) {
            const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
            if (hash !== checksum) {
              p.log.error(
                `Integrity check failed for ${update.name}. Expected ${checksum}, got ${hash}`,
              );
              continue;
            }
          }
          fs.writeFileSync(update.filePath, fileBuffer);
          p.log.success(`Updated ${pc.cyan(update.name)} to v${update.latestVersion}`);
        }
      } catch (err) {
        p.log.warn(`Failed to update ${update.name}: ${toErrorMessage(err)}`);
      }
    }
  } else {
    p.log.info(pc.dim("Run with --yes to auto-install updates."));
  }
};

/**
 * `dojops skills export <path>` — exports skills to a bundle for air-gapped environments.
 */
export const skillsExportCommand: CommandHandler = async (args) => {
  const exportPath = args.find((a) => !a.startsWith("-"));
  if (!exportPath) {
    p.log.info(`  ${pc.dim("$")} dojops skills export <path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Export path required.");
  }

  const rootDir = findProjectRoot() ?? process.cwd();
  const resolvedPath = path.resolve(exportPath);

  const spinner = p.spinner();
  spinner.start("Exporting skills bundle...");

  try {
    const result = exportSkillBundle(resolvedPath, rootDir);
    spinner.stop("Export complete");
    p.log.success(`Exported ${result.count} skill(s) to ${pc.underline(resolvedPath)}`);
  } catch (err) {
    spinner.stop("Export failed");
    throw new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(err));
  }
};

/**
 * `dojops skills import <path>` — imports skills from a bundle directory.
 */
export const skillsImportCommand: CommandHandler = async (args) => {
  const importPath = args.find((a) => !a.startsWith("-"));
  if (!importPath) {
    p.log.info(`  ${pc.dim("$")} dojops skills import <path>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Import path required.");
  }

  const resolvedPath = path.resolve(importPath);

  const spinner = p.spinner();
  spinner.start("Importing skills bundle...");

  try {
    const result = importSkillBundle(resolvedPath);
    spinner.stop("Import complete");
    p.log.success(`Imported ${result.count} skill(s) from ${pc.underline(resolvedPath)}`);
  } catch (err) {
    spinner.stop("Import failed");
    throw new CLIError(ExitCode.GENERAL_ERROR, toErrorMessage(err));
  }
};
