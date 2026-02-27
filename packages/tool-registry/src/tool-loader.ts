import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as yaml from "js-yaml";
import { validateManifest } from "./manifest-schema";
import { ToolEntry, ToolManifest, ToolSource } from "./types";

const TOOL_DIR_NAME = "tools";
const LEGACY_DIR_NAME = "plugins";
const MANIFEST_FILE = "tool.yaml";
const LEGACY_MANIFEST_FILE = "plugin.yaml";

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

function computeHash(dir: string): string {
  const hash = crypto.createHash("sha256");
  const manifestPath = findManifestFile(dir);
  if (manifestPath) {
    hash.update(fs.readFileSync(manifestPath));
  }
  return hash.digest("hex");
}

function loadJsonSchemaFile(dir: string, relativePath: string): Record<string, unknown> | null {
  const fullPath = path.resolve(dir, relativePath);
  // Containment check: ensure the resolved path stays inside the tool directory
  const safeDir = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (!fullPath.startsWith(safeDir)) return null;
  try {
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadToolFromDir(toolDir: string, location: "global" | "project"): ToolEntry | null {
  const manifestPath = findManifestFile(toolDir);
  if (!manifestPath) return null;

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

/**
 * Discover all user .dops files from global and project directories.
 * Project .dops files override global by name.
 */
export function discoverUserDopsFiles(projectPath?: string): DopsFileEntry[] {
  const byName = new Map<string, DopsFileEntry>();

  // Global
  const globalDir = getGlobalToolsDir();
  if (globalDir) {
    for (const entry of discoverDopsFiles(globalDir, "global")) {
      const name = path.basename(entry.filePath, ".dops");
      byName.set(name, entry);
    }
  }

  // Project (overrides global)
  if (projectPath) {
    const projectDir = getProjectToolsDir(projectPath);
    for (const entry of discoverDopsFiles(projectDir, "project")) {
      const name = path.basename(entry.filePath, ".dops");
      byName.set(name, entry);
    }
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
 * Discovers tool manifests from global (~/.dojops/tools/) and project (.dojops/tools/) directories.
 * Falls back to legacy directories (~/.dojops/plugins/, .dojops/plugins/) for backward compatibility.
 * Project tools override global tools of the same name.
 */
export function discoverTools(projectPath?: string): ToolEntry[] {
  return discoverToolsWithWarnings(projectPath).tools;
}

export function discoverToolsWithWarnings(projectPath?: string): ToolDiscoveryResult {
  const tools = new Map<string, ToolEntry>();
  const warnings: string[] = [];

  // 1. Global tools (new path first, fallback to legacy)
  const globalDir = getGlobalToolsDir();
  if (globalDir) {
    discoverFromDir(globalDir, "global", tools, warnings);
  }
  const globalLegacyDir = getGlobalLegacyDir();
  if (globalLegacyDir) {
    discoverFromDir(globalLegacyDir, "global", tools, warnings);
  }

  // 2. Project tools (override global)
  if (projectPath) {
    const projectDir = getProjectToolsDir(projectPath);
    discoverFromDir(projectDir, "project", tools, warnings);
    // Fallback to legacy project dir
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
