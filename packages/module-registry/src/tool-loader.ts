import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as yaml from "js-yaml";
import { validateManifest } from "./manifest-schema";
import { ToolEntry, ToolManifest, ToolSource } from "./types";

const MODULE_DIR_NAME = "modules";
const TOOL_DIR_NAME = "tools";
const LEGACY_DIR_NAME = "plugins";
const MANIFEST_FILE = "tool.yaml";
const LEGACY_MANIFEST_FILE = "plugin.yaml";

/** Maximum allowed file size for manifest and schema files (64KB). */
const MAX_MANIFEST_FILE_SIZE = 65_536;

function getGlobalModulesDir(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, ".dojops", MODULE_DIR_NAME);
}

function getGlobalToolsDir(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, ".dojops", TOOL_DIR_NAME);
}

function getGlobalLegacyDir(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
  return path.join(home, ".dojops", LEGACY_DIR_NAME);
}

function getProjectModulesDir(projectPath: string): string {
  return path.join(projectPath, ".dojops", MODULE_DIR_NAME);
}

function getProjectToolsDir(projectPath: string): string {
  return path.join(projectPath, ".dojops", TOOL_DIR_NAME);
}

function getProjectLegacyDir(projectPath: string): string {
  return path.join(projectPath, ".dojops", LEGACY_DIR_NAME);
}

function findManifestFile(dir: string): string | null {
  const toolYaml = path.join(dir, MANIFEST_FILE);
  if (fs.existsSync(toolYaml)) return toolYaml;
  // Backward compat: fall back to plugin.yaml
  const pluginYaml = path.join(dir, LEGACY_MANIFEST_FILE);
  if (fs.existsSync(pluginYaml)) return pluginYaml;
  return null;
}

/**
 * Returns true if the file at `filePath` exceeds the maximum allowed size.
 * Logs a warning and returns true when the file is too large.
 */
function isFileTooLarge(filePath: string, label: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_MANIFEST_FILE_SIZE) {
      console.warn(
        `[tool-loader] Skipping ${label} "${filePath}": file size ${stat.size} exceeds limit of ${MAX_MANIFEST_FILE_SIZE} bytes`,
      );
      return true;
    }
  } catch {
    // statSync failed — let the subsequent readFileSync handle the error
  }
  return false;
}

function computeHash(dir: string): string {
  const hash = crypto.createHash("sha256");
  const manifestPath = findManifestFile(dir);
  if (manifestPath) {
    if (isFileTooLarge(manifestPath, "manifest")) return "";
    hash.update(fs.readFileSync(manifestPath));
  }
  return hash.digest("hex");
}

function loadJsonSchemaFile(dir: string, relativePath: string): Record<string, unknown> | null {
  try {
    const fullPath = path.resolve(dir, relativePath);

    // Resolve symlinks to real paths before containment check (H-17)
    const realDir = fs.realpathSync(dir);
    let realFullPath: string;
    try {
      realFullPath = fs.realpathSync(fullPath);
    } catch {
      // realpathSync fails for broken symlinks or non-existent files
      return null;
    }

    // Containment check using real paths
    const safeDir = realDir.endsWith(path.sep) ? realDir : realDir + path.sep;
    if (!realFullPath.startsWith(safeDir)) return null;

    // File size check (H-16)
    if (isFileTooLarge(realFullPath, "JSON schema")) return null;

    const content = fs.readFileSync(realFullPath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadToolFromDir(toolDir: string, location: "global" | "project"): ToolEntry | null {
  const manifestPath = findManifestFile(toolDir);
  if (!manifestPath) return null;

  // File size check on manifest (H-16)
  if (isFileTooLarge(manifestPath, "manifest")) return null;

  let raw: unknown;
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    raw = yaml.load(content);
  } catch {
    return null;
  }

  const result = validateManifest(raw);
  if (!result.valid || !result.manifest) return null;

  const manifest = result.manifest as ToolManifest;

  const inputSchemaRaw = loadJsonSchemaFile(toolDir, manifest.inputSchema);
  if (!inputSchemaRaw) return null;

  const outputSchemaRaw = manifest.outputSchema
    ? (loadJsonSchemaFile(toolDir, manifest.outputSchema) ?? undefined)
    : undefined;

  const toolHash = computeHash(toolDir);

  const source: ToolSource = {
    type: "custom",
    location,
    toolPath: toolDir,
    toolVersion: manifest.version,
    toolHash,
  };

  return {
    manifest,
    toolDir,
    source,
    inputSchemaRaw,
    outputSchemaRaw,
  };
}

/**
 * Discovered .dops file path entry.
 */
export interface DopsFileEntry {
  filePath: string;
  location: "global" | "project";
}

/**
 * Discover .dops files from a directory.
 * Returns file paths for .dops files found in the directory.
 */
export function discoverDopsFiles(dir: string, location: "global" | "project"): DopsFileEntry[] {
  const entries: DopsFileEntry[] = [];
  if (!fs.existsSync(dir)) return entries;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith(".dops")) {
        entries.push({ filePath: path.join(dir, file), location });
      }
    }
  } catch {
    // Directory not readable
  }
  return entries;
}

/** Merge discovered .dops entries into the map. When `override` is true, always overwrites; otherwise only adds new names. */
function mergeDopsEntries(
  dir: string,
  location: "global" | "project",
  byName: Map<string, DopsFileEntry>,
  override: boolean,
): void {
  for (const entry of discoverDopsFiles(dir, location)) {
    const name = path.basename(entry.filePath, ".dops");
    if (override || !byName.has(name)) {
      byName.set(name, entry);
    }
  }
}

/**
 * Discover all user .dops files from global and project directories.
 * Project .dops files override global by name.
 */
export function discoverUserDopsFiles(projectPath?: string): DopsFileEntry[] {
  const byName = new Map<string, DopsFileEntry>();

  // Global: modules/ (primary, overrides), then tools/ (fallback, no override)
  const globalModDir = getGlobalModulesDir();
  if (globalModDir) mergeDopsEntries(globalModDir, "global", byName, true);
  const globalDir = getGlobalToolsDir();
  if (globalDir) mergeDopsEntries(globalDir, "global", byName, false);

  // Project (overrides global): modules/ (primary, overrides), then tools/ (fallback, no override)
  if (projectPath) {
    mergeDopsEntries(getProjectModulesDir(projectPath), "project", byName, true);
    mergeDopsEntries(getProjectToolsDir(projectPath), "project", byName, false);
  }

  return Array.from(byName.values());
}

export interface ToolDiscoveryResult {
  tools: ToolEntry[];
  warnings: string[];
}

function discoverFromDir(
  dir: string,
  location: "global" | "project",
  tools: Map<string, ToolEntry>,
  warnings: string[],
): void {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const toolDir = path.join(dir, entry.name);
      const tool = loadToolFromDir(toolDir, location);
      if (tool) {
        tools.set(tool.manifest.name, tool);
      } else {
        warnings.push(`Failed to load tool from ${toolDir} (invalid manifest or missing schema)`);
      }
    }
  } catch (err) {
    warnings.push(
      `Cannot read tools directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Discovers tool manifests from global and project directories.
 * Search order: modules/ (primary) → tools/ (fallback) → plugins/ (legacy).
 * Project entries override global entries of the same name.
 */
export function discoverTools(projectPath?: string): ToolEntry[] {
  return discoverToolsWithWarnings(projectPath).tools;
}

export function discoverToolsWithWarnings(projectPath?: string): ToolDiscoveryResult {
  const tools = new Map<string, ToolEntry>();
  const warnings: string[] = [];

  // 1. Global: modules/ (primary), tools/ (fallback), plugins/ (legacy)
  const globalModDir = getGlobalModulesDir();
  if (globalModDir) {
    discoverFromDir(globalModDir, "global", tools, warnings);
  }
  const globalDir = getGlobalToolsDir();
  if (globalDir) {
    discoverFromDir(globalDir, "global", tools, warnings);
  }
  const globalLegacyDir = getGlobalLegacyDir();
  if (globalLegacyDir) {
    discoverFromDir(globalLegacyDir, "global", tools, warnings);
  }

  // 2. Project (overrides global): modules/ (primary), tools/ (fallback), plugins/ (legacy)
  if (projectPath) {
    const projectModDir = getProjectModulesDir(projectPath);
    discoverFromDir(projectModDir, "project", tools, warnings);
    const projectDir = getProjectToolsDir(projectPath);
    discoverFromDir(projectDir, "project", tools, warnings);
    const projectLegacy = getProjectLegacyDir(projectPath);
    discoverFromDir(projectLegacy, "project", tools, warnings);
  }

  return { tools: Array.from(tools.values()), warnings };
}

// Backward compatibility aliases
/** @deprecated Use discoverTools instead */
export const discoverPlugins = discoverTools;
/** @deprecated Use discoverToolsWithWarnings instead */
export const discoverPluginsWithWarnings = discoverToolsWithWarnings;
/** @deprecated Use ToolDiscoveryResult instead */
export type PluginDiscoveryResult = ToolDiscoveryResult;
