import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as yaml from "js-yaml";
import { validateManifest } from "./manifest-schema";
import { PluginEntry, PluginManifest, PluginSource } from "./types";

const PLUGIN_DIR_NAME = "plugins";
const MANIFEST_FILE = "plugin.yaml";

function getGlobalPluginsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".dojops", PLUGIN_DIR_NAME);
}

function getProjectPluginsDir(projectPath: string): string {
  return path.join(projectPath, ".dojops", PLUGIN_DIR_NAME);
}

function computeHash(dir: string): string {
  const hash = crypto.createHash("sha256");
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (fs.existsSync(manifestPath)) {
    hash.update(fs.readFileSync(manifestPath));
  }
  return hash.digest("hex");
}

function loadJsonSchemaFile(dir: string, relativePath: string): Record<string, unknown> | null {
  const fullPath = path.resolve(dir, relativePath);
  try {
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadPluginFromDir(pluginDir: string, location: "global" | "project"): PluginEntry | null {
  const manifestPath = path.join(pluginDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;

  let raw: unknown;
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    raw = yaml.load(content);
  } catch {
    return null;
  }

  const result = validateManifest(raw);
  if (!result.valid || !result.manifest) return null;

  const manifest = result.manifest as PluginManifest;

  const inputSchemaRaw = loadJsonSchemaFile(pluginDir, manifest.inputSchema);
  if (!inputSchemaRaw) return null;

  const outputSchemaRaw = manifest.outputSchema
    ? (loadJsonSchemaFile(pluginDir, manifest.outputSchema) ?? undefined)
    : undefined;

  const pluginHash = computeHash(pluginDir);

  const source: PluginSource = {
    type: "plugin",
    location,
    pluginPath: pluginDir,
    pluginVersion: manifest.version,
    pluginHash,
  };

  return {
    manifest,
    pluginDir,
    source,
    inputSchemaRaw,
    outputSchemaRaw,
  };
}

export interface PluginDiscoveryResult {
  plugins: PluginEntry[];
  warnings: string[];
}

/**
 * Discovers plugin manifests from global (~/.dojops/plugins/) and project (.dojops/plugins/) directories.
 * Project plugins override global plugins of the same name.
 */
export function discoverPlugins(projectPath?: string): PluginEntry[] {
  return discoverPluginsWithWarnings(projectPath).plugins;
}

export function discoverPluginsWithWarnings(projectPath?: string): PluginDiscoveryResult {
  const plugins = new Map<string, PluginEntry>();
  const warnings: string[] = [];

  // 1. Global plugins
  const globalDir = getGlobalPluginsDir();
  if (fs.existsSync(globalDir)) {
    try {
      const entries = fs.readdirSync(globalDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(globalDir, entry.name);
        const plugin = loadPluginFromDir(pluginDir, "global");
        if (plugin) {
          plugins.set(plugin.manifest.name, plugin);
        } else {
          warnings.push(
            `Failed to load plugin from ${pluginDir} (invalid manifest or missing schema)`,
          );
        }
      }
    } catch (err) {
      warnings.push(
        `Cannot read global plugins directory: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Project plugins (override global)
  if (projectPath) {
    const projectDir = getProjectPluginsDir(projectPath);
    if (fs.existsSync(projectDir)) {
      try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const pluginDir = path.join(projectDir, entry.name);
          const plugin = loadPluginFromDir(pluginDir, "project");
          if (plugin) {
            plugins.set(plugin.manifest.name, plugin);
          } else {
            warnings.push(
              `Failed to load plugin from ${pluginDir} (invalid manifest or missing schema)`,
            );
          }
        }
      } catch (err) {
        warnings.push(
          `Cannot read project plugins directory: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  return { plugins: Array.from(plugins.values()), warnings };
}
