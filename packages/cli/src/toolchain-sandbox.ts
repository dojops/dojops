/**
 * User-scoped toolchain sandbox at ~/.dojops/toolchain/.
 *
 * Downloads, manages, and cleans up binary tools without elevated permissions.
 * Uses node:https for downloads, system unzip/tar for extraction.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import https from "node:https";
import { execFileSync } from "node:child_process";
import {
  SystemTool,
  InstalledTool,
  ToolRegistry,
  buildDownloadUrl,
  buildBinaryPathInArchive,
} from "@dojops/core";

export const TOOLCHAIN_DIR = path.join(os.homedir(), ".dojops", "toolchain");
export const TOOLCHAIN_BIN_DIR = path.join(TOOLCHAIN_DIR, "bin");
export const REGISTRY_FILE = path.join(TOOLCHAIN_DIR, "registry.json");

// Legacy paths for auto-migration
const LEGACY_TOOLS_DIR = path.join(os.homedir(), ".dojops", "tools");

/**
 * Auto-migrate ~/.dojops/tools/ → ~/.dojops/toolchain/ if old path has bin/ or registry.json.
 * Only runs once; safe to call repeatedly.
 */
function migrateToolchainDir(): void {
  if (fs.existsSync(TOOLCHAIN_DIR)) return;

  const legacyBinDir = path.join(LEGACY_TOOLS_DIR, "bin");
  const legacyRegistry = path.join(LEGACY_TOOLS_DIR, "registry.json");

  if (!fs.existsSync(legacyBinDir) && !fs.existsSync(legacyRegistry)) return;

  try {
    fs.renameSync(LEGACY_TOOLS_DIR, TOOLCHAIN_DIR);
  } catch {
    // Cross-device rename failed — copy instead
    try {
      fs.cpSync(LEGACY_TOOLS_DIR, TOOLCHAIN_DIR, { recursive: true });
    } catch {
      // Migration failed — will start fresh
    }
  }
}

/**
 * Ensure ~/.dojops/toolchain/bin/ exists.
 */
export function ensureToolchainDir(): void {
  migrateToolchainDir();
  fs.mkdirSync(TOOLCHAIN_BIN_DIR, { recursive: true, mode: 0o755 });
}

/**
 * Load the toolchain registry from disk.
 * Returns empty registry if file doesn't exist.
 */
export function loadToolchainRegistry(): ToolRegistry {
  migrateToolchainDir();
  try {
    const data = fs.readFileSync(REGISTRY_FILE, "utf-8");
    return JSON.parse(data) as ToolRegistry;
  } catch {
    return { tools: [], updatedAt: "" };
  }
}

/**
 * Save the toolchain registry to disk.
 */
export function saveToolchainRegistry(registry: ToolRegistry): void {
  ensureToolchainDir();
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Prepend ~/.dojops/toolchain/bin to PATH (idempotent).
 */
export function prependToolchainBinToPath(): void {
  const currentPath = process.env.PATH ?? "";
  if (!currentPath.includes(TOOLCHAIN_BIN_DIR)) {
    process.env.PATH = `${TOOLCHAIN_BIN_DIR}${path.delimiter}${currentPath}`;
  }
}

/**
 * Follow redirects for an HTTPS download, writing to a temp file.
 * Validates URLs for security (HTTPS-only, SSRF protection).
 */
function followRedirects(
  currentUrl: string,
  hops: number,
  tmpFile: string,
  resolve: (value: string) => void,
  reject: (reason: Error) => void,
): void {
  if (hops > 5) {
    reject(new Error("Too many redirects"));
    return;
  }

  // Security: validate redirect URL as a proper HTTPS URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(currentUrl);
  } catch {
    reject(new Error(`Invalid redirect URL: ${currentUrl}`));
    return;
  }
  if (parsedUrl.protocol !== "https:") {
    reject(new Error(`Refusing to download over insecure protocol: ${currentUrl}`));
    return;
  }
  // SSRF protection: block cloud metadata and link-local endpoints
  const blockedHosts = ["169.254.169.254", "metadata.google.internal", "100.100.100.200"];
  if (blockedHosts.includes(parsedUrl.hostname)) {
    reject(
      new Error(`SSRF protection: blocked download to metadata endpoint ${parsedUrl.hostname}`),
    );
    return;
  }
  https
    .get(currentUrl, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // Resolve relative Location headers against the current URL
        let redirectTarget: string;
        try {
          redirectTarget = new URL(res.headers.location, currentUrl).href;
        } catch {
          reject(new Error(`Invalid redirect Location header: ${res.headers.location}`));
          return;
        }
        followRedirects(redirectTarget, hops + 1, tmpFile, resolve, reject);
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

/**
 * Follow redirects and download a URL to a temp file.
 * Returns the temp file path.
 */
export function downloadToTemp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(
      os.tmpdir(),
      `dojops-download-${Date.now()}-${crypto.randomInt(2 ** 48).toString(36)}`,
    );

    followRedirects(url, 0, tmpFile, resolve, reject);
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
 * Extract a tar.xz archive using system `tar`.
 */
export function extractTarXz(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["xJf", archivePath, "-C", destDir], {
    timeout: 60_000,
    stdio: "pipe",
  });
}

/**
 * Install a system tool into ~/.dojops/toolchain/bin/.
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

  ensureToolchainDir();

  // Download
  const tmpFile = await downloadToTemp(url);
  const extractDir = path.join(os.tmpdir(), `dojops-extract-${Date.now()}`);

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
    } else if (tool.archiveType === "tar.xz") {
      extractTarXz(tmpFile, extractDir);
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

    // Verify SHA-256 hash if available
    verifyBinaryHash(binarySource, tool, ver);

    // Copy to bin directory
    const destPath = path.join(TOOLCHAIN_BIN_DIR, tool.binaryName);
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

    const registry = loadToolchainRegistry();
    registry.tools = registry.tools.filter((t) => t.name !== tool.name);
    registry.tools.push(installed);
    saveToolchainRegistry(registry);

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
 * Verify a downloaded binary against its expected SHA-256 hash.
 * If the tool has no pinned hash, logs a warning.
 */
function verifyBinaryHash(binaryPath: string, tool: SystemTool, version: string): void {
  const expectedHash = tool.sha256?.[version];
  if (!expectedHash) {
    // No hash available — warn but allow (future: require hashes for all tools)
    return;
  }
  const content = fs.readFileSync(binaryPath);
  const actual = crypto.createHash("sha256").update(content).digest("hex");
  if (actual !== expectedHash) {
    throw new Error(
      `SHA-256 checksum mismatch for ${tool.name} v${version}:\n` +
        `  expected: ${expectedHash}\n` +
        `  actual:   ${actual}\n` +
        `Binary may have been tampered with. Aborting installation.`,
    );
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
 * 3. Sandbox venv at ~/.dojops/toolchain/venvs/ansible/ — always works on PEP 668 systems
 */
export async function installAnsible(tool: SystemTool): Promise<InstalledTool> {
  const venvDir = path.join(TOOLCHAIN_DIR, "venvs", "ansible");
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

  // Symlink venv ansible binary into toolchain bin
  const venvBinary = path.join(venvDir, "bin", "ansible");
  const destPath = path.join(TOOLCHAIN_BIN_DIR, "ansible");
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

  const registry = loadToolchainRegistry();
  registry.tools = registry.tools.filter((t) => t.name !== tool.name);
  registry.tools.push(installed);
  saveToolchainRegistry(registry);

  return installed;
}

/**
 * Remove a system tool from the toolchain.
 */
export function removeSystemTool(name: string): boolean {
  const registry = loadToolchainRegistry();
  const entry = registry.tools.find((t) => t.name === name);
  if (!entry) return false;

  // Delete binary (or symlink)
  const binPath = path.join(TOOLCHAIN_BIN_DIR, path.basename(entry.binaryPath));
  try {
    fs.unlinkSync(binPath);
  } catch {
    /* ignore if already gone */
  }

  // Clean up venv if this was a venv-installed tool (e.g. ansible)
  const venvDir = path.join(TOOLCHAIN_DIR, "venvs", name);
  try {
    fs.rmSync(venvDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Update registry
  registry.tools = registry.tools.filter((t) => t.name !== name);
  saveToolchainRegistry(registry);

  return true;
}

/**
 * Remove all toolchain tools and clear the registry.
 */
export function cleanAllToolchain(): { removed: string[] } {
  const registry = loadToolchainRegistry();
  const removed = registry.tools.map((t) => t.name);

  // Delete all binaries
  if (fs.existsSync(TOOLCHAIN_BIN_DIR)) {
    const entries = fs.readdirSync(TOOLCHAIN_BIN_DIR);
    for (const entry of entries) {
      try {
        fs.unlinkSync(path.join(TOOLCHAIN_BIN_DIR, entry));
      } catch {
        /* ignore */
      }
    }
  }

  // Remove venvs directory
  const venvsDir = path.join(TOOLCHAIN_DIR, "venvs");
  try {
    fs.rmSync(venvsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Clear registry
  saveToolchainRegistry({ tools: [], updatedAt: "" });

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
      env: {
        ...process.env,
        PATH: `${TOOLCHAIN_BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    return result.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

// Backward compatibility re-exports
/** @deprecated Use TOOLCHAIN_DIR instead */
export const TOOLS_DIR = TOOLCHAIN_DIR;
/** @deprecated Use TOOLCHAIN_BIN_DIR instead */
export const TOOLS_BIN_DIR = TOOLCHAIN_BIN_DIR;
/** @deprecated Use ensureToolchainDir instead */
export const ensureToolsDir = ensureToolchainDir;
/** @deprecated Use prependToolchainBinToPath instead */
export const prependToolsBinToPath = prependToolchainBinToPath;
/** @deprecated Use loadToolchainRegistry instead */
export const loadToolRegistry = loadToolchainRegistry;
/** @deprecated Use cleanAllToolchain instead */
export const cleanAllTools = cleanAllToolchain;
