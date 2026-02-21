/**
 * User-scoped tool sandbox at ~/.oda/tools/.
 *
 * Downloads, manages, and cleans up binary tools without elevated permissions.
 * Uses node:https for downloads, system unzip/tar for extraction.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { execFileSync } from "node:child_process";
import {
  SystemTool,
  InstalledTool,
  ToolRegistry,
  buildDownloadUrl,
  buildBinaryPathInArchive,
} from "@odaops/core";

export const TOOLS_DIR = path.join(os.homedir(), ".oda", "tools");
export const TOOLS_BIN_DIR = path.join(TOOLS_DIR, "bin");
export const REGISTRY_FILE = path.join(TOOLS_DIR, "registry.json");

/**
 * Ensure ~/.oda/tools/bin/ exists.
 */
export function ensureToolsDir(): void {
  fs.mkdirSync(TOOLS_BIN_DIR, { recursive: true, mode: 0o755 });
}

/**
 * Load the tool registry from disk.
 * Returns empty registry if file doesn't exist.
 */
export function loadToolRegistry(): ToolRegistry {
  try {
    const data = fs.readFileSync(REGISTRY_FILE, "utf-8");
    return JSON.parse(data) as ToolRegistry;
  } catch {
    return { tools: [], updatedAt: "" };
  }
}

/**
 * Save the tool registry to disk.
 */
export function saveToolRegistry(registry: ToolRegistry): void {
  ensureToolsDir();
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Prepend ~/.oda/tools/bin to PATH (idempotent).
 */
export function prependToolsBinToPath(): void {
  const currentPath = process.env.PATH ?? "";
  if (!currentPath.includes(TOOLS_BIN_DIR)) {
    process.env.PATH = `${TOOLS_BIN_DIR}${path.delimiter}${currentPath}`;
  }
}

/**
 * Follow redirects and download a URL to a temp file.
 * Returns the temp file path.
 */
export function downloadToTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(
      os.tmpdir(),
      `oda-download-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );

    function follow(currentUrl: string, hops: number): void {
      if (hops > 5) {
        reject(new Error("Too many redirects"));
        return;
      }

      const client = currentUrl.startsWith("https") ? https : http;
      client
        .get(currentUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            follow(res.headers.location, hops + 1);
            return;
          }

          if (!res.statusCode || res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Download failed: HTTP ${res.statusCode} from ${currentUrl}`));
            return;
          }

          const stream = fs.createWriteStream(tmpFile);
          res.pipe(stream);
          stream.on("finish", () => {
            stream.close();
            resolve(tmpFile);
          });
          stream.on("error", (err) => {
            fs.unlinkSync(tmpFile);
            reject(err);
          });
        })
        .on("error", reject);
    }

    follow(url, 0);
  });
}

/**
 * Extract a zip archive using system `unzip`.
 */
export function extractZip(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("unzip", ["-o", archivePath, "-d", destDir], {
    timeout: 60_000,
    stdio: "pipe",
  });
}

/**
 * Extract a tar.gz archive using system `tar`.
 */
export function extractTarGz(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["xzf", archivePath, "-C", destDir], {
    timeout: 60_000,
    stdio: "pipe",
  });
}

/**
 * Install a system tool into ~/.oda/tools/bin/.
 */
export async function installSystemTool(
  tool: SystemTool,
  version?: string,
): Promise<InstalledTool> {
  if (tool.archiveType === "pipx") {
    return installAnsible(tool);
  }

  const ver = version ?? tool.latestVersion;
  const url = buildDownloadUrl(tool, ver);
  if (!url) {
    throw new Error(`Cannot build download URL for ${tool.name}`);
  }

  ensureToolsDir();

  // Download
  const tmpFile = await downloadToTemp(url);
  const extractDir = path.join(os.tmpdir(), `oda-extract-${Date.now()}`);

  try {
    let binarySource: string;

    if (tool.archiveType === "standalone") {
      // Direct binary download
      binarySource = tmpFile;
    } else if (tool.archiveType === "zip") {
      extractZip(tmpFile, extractDir);
      const archiveBinPath = buildBinaryPathInArchive(tool, ver);
      binarySource = archiveBinPath
        ? path.join(extractDir, archiveBinPath)
        : path.join(extractDir, tool.binaryName);
    } else {
      // tar.gz
      extractTarGz(tmpFile, extractDir);
      const archiveBinPath = buildBinaryPathInArchive(tool, ver);
      binarySource = archiveBinPath
        ? path.join(extractDir, archiveBinPath)
        : path.join(extractDir, tool.binaryName);
    }

    // Copy to bin directory
    const destPath = path.join(TOOLS_BIN_DIR, tool.binaryName);
    fs.copyFileSync(binarySource, destPath);
    fs.chmodSync(destPath, 0o755);

    // Update registry
    const stat = fs.statSync(destPath);
    const installed: InstalledTool = {
      name: tool.name,
      version: ver,
      installedAt: new Date().toISOString(),
      size: stat.size,
      binaryPath: destPath,
    };

    const registry = loadToolRegistry();
    registry.tools = registry.tools.filter((t) => t.name !== tool.name);
    registry.tools.push(installed);
    saveToolRegistry(registry);

    return installed;
  } finally {
    // Cleanup temp files
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Check if a command exists on PATH.
 */
function commandExists(name: string): boolean {
  try {
    execFileSync("which", [name], { timeout: 5_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install ansible via pipx, python3 -m pipx, or a sandbox venv.
 *
 * Strategy order:
 * 1. `pipx install ansible` — if pipx binary is on PATH
 * 2. `python3 -m pipx install ansible` — if pipx is available as a Python module
 * 3. Sandbox venv at ~/.oda/tools/venvs/ansible/ — always works on PEP 668 systems
 */
export async function installAnsible(tool: SystemTool): Promise<InstalledTool> {
  const venvDir = path.join(TOOLS_DIR, "venvs", "ansible");
  let binaryPath: string;

  // Strategy 1: pipx binary
  if (commandExists("pipx")) {
    execFileSync("pipx", ["install", "ansible"], { timeout: 300_000, stdio: "pipe" });
    binaryPath = findInstalledBinary("ansible");
    return registerAnsible(tool, binaryPath);
  }

  // Strategy 2: python3 -m pipx
  if (commandExists("python3")) {
    try {
      execFileSync("python3", ["-m", "pipx", "install", "ansible"], {
        timeout: 300_000,
        stdio: "pipe",
      });
      binaryPath = findInstalledBinary("ansible");
      return registerAnsible(tool, binaryPath);
    } catch {
      // pipx module not available — fall through to venv
    }
  }

  // Strategy 3: sandbox venv
  const python = commandExists("python3") ? "python3" : "python";
  fs.mkdirSync(venvDir, { recursive: true });
  execFileSync(python, ["-m", "venv", venvDir], { timeout: 60_000, stdio: "pipe" });

  const venvPip = path.join(venvDir, "bin", "pip");
  execFileSync(venvPip, ["install", "ansible"], { timeout: 300_000, stdio: "pipe" });

  // Symlink venv ansible binary into sandbox bin
  const venvBinary = path.join(venvDir, "bin", "ansible");
  const destPath = path.join(TOOLS_BIN_DIR, "ansible");
  try {
    fs.unlinkSync(destPath);
  } catch {
    /* may not exist */
  }
  fs.symlinkSync(venvBinary, destPath);
  binaryPath = destPath;

  return registerAnsible(tool, binaryPath);
}

function findInstalledBinary(name: string): string {
  try {
    const result = execFileSync("which", [name], {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    return result.trim();
  } catch {
    return name;
  }
}

function registerAnsible(tool: SystemTool, binaryPath: string): InstalledTool {
  const installed: InstalledTool = {
    name: tool.name,
    version: tool.latestVersion,
    installedAt: new Date().toISOString(),
    size: 0,
    binaryPath,
  };

  const registry = loadToolRegistry();
  registry.tools = registry.tools.filter((t) => t.name !== tool.name);
  registry.tools.push(installed);
  saveToolRegistry(registry);

  return installed;
}

/**
 * Remove a system tool from the sandbox.
 */
export function removeSystemTool(name: string): boolean {
  const registry = loadToolRegistry();
  const entry = registry.tools.find((t) => t.name === name);
  if (!entry) return false;

  // Delete binary (or symlink)
  const binPath = path.join(TOOLS_BIN_DIR, path.basename(entry.binaryPath));
  try {
    fs.unlinkSync(binPath);
  } catch {
    /* ignore if already gone */
  }

  // Clean up venv if this was a venv-installed tool (e.g. ansible)
  const venvDir = path.join(TOOLS_DIR, "venvs", name);
  try {
    fs.rmSync(venvDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Update registry
  registry.tools = registry.tools.filter((t) => t.name !== name);
  saveToolRegistry(registry);

  return true;
}

/**
 * Remove all sandbox tools and clear the registry.
 */
export function cleanAllTools(): { removed: string[] } {
  const registry = loadToolRegistry();
  const removed = registry.tools.map((t) => t.name);

  // Delete all binaries
  if (fs.existsSync(TOOLS_BIN_DIR)) {
    const entries = fs.readdirSync(TOOLS_BIN_DIR);
    for (const entry of entries) {
      try {
        fs.unlinkSync(path.join(TOOLS_BIN_DIR, entry));
      } catch {
        /* ignore */
      }
    }
  }

  // Remove venvs directory
  const venvsDir = path.join(TOOLS_DIR, "venvs");
  try {
    fs.rmSync(venvsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Clear registry
  saveToolRegistry({ tools: [], updatedAt: "" });

  return { removed };
}

/**
 * Run a tool's verify command and return the version output.
 * Returns undefined if verification fails.
 */
export function verifyTool(tool: SystemTool): string | undefined {
  try {
    const [cmd, ...args] = tool.verifyCommand;
    const result = execFileSync(cmd, args, {
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      env: { ...process.env, PATH: `${TOOLS_BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    return result.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}
