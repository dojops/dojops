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
import { runBin } from "./safe-exec";
import { mkdirExecutable, chmodExecutable } from "./secure-fs";
import {
  SystemTool,
  InstalledTool,
  ToolRegistry,
  buildDownloadUrl,
  buildBinaryPathInArchive,
  BINARY_TO_SYSTEM_TOOL,
  findSystemTool,
} from "@dojops/core";

export const TOOLCHAIN_DIR = path.join(os.homedir(), ".dojops", "toolchain");
export const TOOLCHAIN_BIN_DIR = path.join(TOOLCHAIN_DIR, "bin");
export const TOOLCHAIN_NODE_MODULES = path.join(TOOLCHAIN_DIR, "node_modules");
export const TOOLCHAIN_NPM_BIN = path.join(TOOLCHAIN_NODE_MODULES, ".bin");
export const REGISTRY_FILE = path.join(TOOLCHAIN_DIR, "registry.json");

/** Resolved paths for a toolchain scope (global or project). */
export interface ToolchainContext {
  dir: string;
  binDir: string;
  nodeModules: string;
  npmBin: string;
  registryFile: string;
}

/** Build toolchain paths for the global scope. */
export function globalToolchainCtx(): ToolchainContext {
  return {
    dir: TOOLCHAIN_DIR,
    binDir: TOOLCHAIN_BIN_DIR,
    nodeModules: TOOLCHAIN_NODE_MODULES,
    npmBin: TOOLCHAIN_NPM_BIN,
    registryFile: REGISTRY_FILE,
  };
}

/** Build toolchain paths for a project scope. */
export function projectToolchainCtx(projectRoot: string): ToolchainContext {
  const dir = path.join(projectRoot, ".dojops", "toolchain");
  return {
    dir,
    binDir: path.join(dir, "bin"),
    nodeModules: path.join(dir, "node_modules"),
    npmBin: path.join(dir, "node_modules", ".bin"),
    registryFile: path.join(dir, "registry.json"),
  };
}

// Legacy paths for auto-migration
const LEGACY_TOOLS_DIR = path.join(os.homedir(), ".dojops", "tools");

/**
 * Auto-migrate ~/.dojops/tools/ → ~/.dojops/toolchain/ if old path has bin/ or registry.json.
 * Handles three cases:
 * 1. Only tools/ exists → rename to toolchain/
 * 2. Both exist → merge binaries and registry entries from tools/ into toolchain/
 * 3. Only toolchain/ exists → nothing to do
 */
function migrateToolchainDir(): void {
  const legacyBinDir = path.join(LEGACY_TOOLS_DIR, "bin");
  const legacyRegistry = path.join(LEGACY_TOOLS_DIR, "registry.json");

  if (!fs.existsSync(legacyBinDir) && !fs.existsSync(legacyRegistry)) return;

  if (!fs.existsSync(TOOLCHAIN_DIR)) {
    // Case 1: only tools/ exists — rename
    try {
      fs.renameSync(LEGACY_TOOLS_DIR, TOOLCHAIN_DIR);
    } catch {
      try {
        fs.cpSync(LEGACY_TOOLS_DIR, TOOLCHAIN_DIR, { recursive: true });
      } catch {
        return;
      }
    }
    return;
  }

  // Case 2: both exist — merge legacy binaries into toolchain
  try {
    const toolchainBinDir = path.join(TOOLCHAIN_DIR, "bin");
    fs.mkdirSync(toolchainBinDir, { recursive: true });

    // Copy binaries that don't already exist in toolchain
    if (fs.existsSync(legacyBinDir)) {
      for (const entry of fs.readdirSync(legacyBinDir)) {
        const dest = path.join(toolchainBinDir, entry);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(path.join(legacyBinDir, entry), dest);
          try {
            fs.chmodSync(dest, 0o755);
          } catch {
            /* ignore */
          }
        }
      }
    }

    // Merge registry entries — update stale paths to toolchain/
    if (fs.existsSync(legacyRegistry)) {
      try {
        const legacyReg = JSON.parse(fs.readFileSync(legacyRegistry, "utf-8")) as ToolRegistry;
        const currentReg = loadToolchainRegistry();
        const currentNames = new Set(currentReg.tools.map((t) => t.name));

        for (const tool of legacyReg.tools) {
          if (currentNames.has(tool.name)) continue;
          // Rewrite path from tools/ to toolchain/
          tool.binaryPath = tool.binaryPath.replace(
            `${path.sep}tools${path.sep}`,
            `${path.sep}toolchain${path.sep}`,
          );
          currentReg.tools.push(tool);
        }
        saveToolchainRegistry(currentReg);
      } catch {
        /* registry merge failed — not critical */
      }
    }

    // Remove legacy directory after successful merge
    fs.rmSync(LEGACY_TOOLS_DIR, { recursive: true, force: true });
  } catch {
    /* merge failed — leave both directories intact */
  }
}

/**
 * Ensure toolchain bin directory exists.
 */
export function ensureToolchainDir(ctx?: ToolchainContext): void {
  if (!ctx || ctx.dir === TOOLCHAIN_DIR) migrateToolchainDir();
  mkdirExecutable((ctx ?? globalToolchainCtx()).binDir);
}

/**
 * Load the toolchain registry from disk.
 * Returns empty registry if file doesn't exist.
 */
export function loadToolchainRegistry(ctx?: ToolchainContext): ToolRegistry {
  const tc = ctx ?? globalToolchainCtx();
  if (tc.dir === TOOLCHAIN_DIR) migrateToolchainDir();
  try {
    const data = fs.readFileSync(tc.registryFile, "utf-8");
    return JSON.parse(data) as ToolRegistry;
  } catch {
    return { tools: [], updatedAt: "" };
  }
}

/**
 * Save the toolchain registry to disk.
 */
export function saveToolchainRegistry(registry: ToolRegistry, ctx?: ToolchainContext): void {
  ensureToolchainDir(ctx);
  const tc = ctx ?? globalToolchainCtx();
  registry.updatedAt = new Date().toISOString();
  fs.writeFileSync(tc.registryFile, JSON.stringify(registry, null, 2), "utf-8");
}

/**
 * Prepend toolchain bin dirs to PATH (idempotent).
 * When a project context is given, both project and global dirs are prepended
 * (project first so project-scoped binaries take precedence).
 */
export function prependToolchainBinToPath(projectCtx?: ToolchainContext): void {
  const currentPath = process.env.PATH ?? "";
  const globalCtx = globalToolchainCtx();
  const dirs: string[] = [];
  if (projectCtx) {
    dirs.push(projectCtx.binDir, projectCtx.npmBin);
  }
  dirs.push(globalCtx.binDir, globalCtx.npmBin);
  const toAdd = dirs.filter((d) => !currentPath.includes(d));
  if (toAdd.length > 0) {
    process.env.PATH = `${toAdd.join(path.delimiter)}${path.delimiter}${currentPath}`;
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
      `dojops-download-${Date.now()}-${crypto.randomInt(2 ** 48 - 1).toString(36)}`,
    );

    followRedirects(url, 0, tmpFile, resolve, reject);
  });
}

/**
 * Extract a zip archive using system `unzip`.
 */
export function extractZip(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  runBin("unzip", ["-o", archivePath, "-d", destDir], {
    timeout: 60_000,
    stdio: "pipe",
  });
}

/**
 * Extract a tar.gz archive using system `tar`.
 */
export function extractTarGz(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  runBin("tar", ["xzf", archivePath, "-C", destDir], {
    timeout: 60_000,
    stdio: "pipe",
  });
}

/**
 * Extract a tar.xz archive using system `tar`.
 */
export function extractTarXz(archivePath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  runBin("tar", ["xJf", archivePath, "-C", destDir], {
    timeout: 60_000,
    stdio: "pipe",
  });
}

/**
 * Install a system tool into the toolchain bin directory.
 */
export async function installSystemTool(
  tool: SystemTool,
  version?: string,
  ctx?: ToolchainContext,
): Promise<InstalledTool> {
  if (tool.archiveType === "pipx") {
    return installPipTool(tool, ctx);
  }
  if (tool.archiveType === "source") {
    return installFromSource(tool, version, ctx);
  }

  const tc = ctx ?? globalToolchainCtx();
  const ver = version ?? tool.latestVersion;
  const url = buildDownloadUrl(tool, ver);
  if (!url) {
    throw new Error(`Cannot build download URL for ${tool.name}`);
  }

  ensureToolchainDir(ctx);

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
    const destPath = path.join(tc.binDir, tool.binaryName);
    fs.copyFileSync(binarySource, destPath);
    chmodExecutable(destPath);

    // Update registry
    const stat = fs.statSync(destPath);
    const installed: InstalledTool = {
      name: tool.name,
      version: ver,
      installedAt: new Date().toISOString(),
      size: stat.size,
      binaryPath: destPath,
    };

    const registry = loadToolchainRegistry(ctx);
    registry.tools = registry.tools.filter((t) => t.name !== tool.name);
    registry.tools.push(installed);
    saveToolchainRegistry(registry, ctx);

    // Run post-install commands (e.g. trivy DB download)
    if (tool.postInstallCommands?.length) {
      for (const [cmd, ...args] of tool.postInstallCommands) {
        try {
          runBin(cmd, args, {
            timeout: 120_000,
            stdio: "pipe",
            env: {
              ...process.env,
              PATH: `${tc.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
            },
          });
        } catch {
          // Post-install failed — tool is still installed, setup will retry on first use
        }
      }
    }

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
    runBin("which", [name], { timeout: 5_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a Python tool via a sandboxed venv or pipx fallback.
 *
 * Strategy order (sandboxed-first):
 * 1. Sandbox venv at ~/.dojops/toolchain/venvs/<name>/ — fully sandboxed, always works with python3
 * 2. `pipx install <name>` — fallback if python3 is unavailable
 *
 * If an existing venv has broken shebangs (e.g., after directory migration),
 * the venv is deleted and recreated.
 */
export async function installPipTool(
  tool: SystemTool,
  ctx?: ToolchainContext,
): Promise<InstalledTool> {
  const tc = ctx ?? globalToolchainCtx();
  ensureToolchainDir(ctx);
  const venvDir = path.join(tc.dir, "venvs", tool.name);
  let binaryPath: string;

  // Strategy 1: sandbox venv (preferred — fully sandboxed)
  const pythonFallback = commandExists("python") ? "python" : null;
  const python = commandExists("python3") ? "python3" : pythonFallback;
  if (python) {
    // Clean up broken venv (stale shebangs from directory migration)
    if (fs.existsSync(venvDir)) {
      const venvPython = path.join(venvDir, "bin", "python3");
      if (!fs.existsSync(venvPython) || !isVenvScriptWorking(path.join(venvDir, "bin", "pip"))) {
        fs.rmSync(venvDir, { recursive: true, force: true });
      }
    }

    if (!fs.existsSync(venvDir)) {
      fs.mkdirSync(venvDir, { recursive: true });
      runBin(python, ["-m", "venv", venvDir], { timeout: 60_000, stdio: "pipe" });
    }

    const venvPip = path.join(venvDir, "bin", "pip");
    runBin(venvPip, ["install", tool.name], { timeout: 300_000, stdio: "pipe" });

    // Symlink venv binary into toolchain bin
    const venvBinary = path.join(venvDir, "bin", tool.binaryName);
    const destPath = path.join(tc.binDir, tool.binaryName);
    try {
      fs.unlinkSync(destPath);
    } catch {
      /* may not exist */
    }
    fs.symlinkSync(venvBinary, destPath);
    binaryPath = destPath;

    // Ansible-specific: symlink companion binaries
    if (tool.name === "ansible") {
      symlinkAnsibleCompanions(venvBinary, ctx);
    }

    return registerPipTool(tool, binaryPath, ctx);
  }

  // Strategy 2: pipx fallback (when python3 is not available)
  if (commandExists("pipx")) {
    runBin("pipx", ["install", tool.name], { timeout: 300_000, stdio: "pipe" });
    ensurePipxBinOnPath();
    binaryPath = findInstalledBinary(tool.binaryName);
    if (tool.name === "ansible") {
      symlinkAnsibleCompanions(binaryPath, ctx);
    }
    return registerPipTool(tool, binaryPath, ctx);
  }

  throw new Error(
    `Cannot install ${tool.name}: neither python3 nor pipx found. ` +
      "Install python3 (recommended) or pipx first.",
  );
}

/** @deprecated Use installPipTool instead */
export const installAnsible = installPipTool;

/**
 * Ansible companion binaries that should be symlinked alongside the main binary.
 */
const ANSIBLE_COMPANIONS = [
  "ansible-playbook",
  "ansible-galaxy",
  "ansible-vault",
  "ansible-lint",
  "ansible-doc",
  "ansible-config",
  "ansible-console",
  "ansible-inventory",
  "ansible-pull",
];

/**
 * Check if a Python venv script has a working shebang (the interpreter exists).
 */
function isVenvScriptWorking(scriptPath: string): boolean {
  try {
    const content = fs.readFileSync(scriptPath, "utf-8");
    const shebang = content.split("\n")[0];
    if (!shebang.startsWith("#!")) return false;
    const interpreter = shebang.slice(2).trim();
    return fs.existsSync(interpreter);
  } catch {
    return false;
  }
}

/**
 * Resolve the directory containing ansible companion binaries.
 * Tries multiple strategies since pipx/venv paths vary by platform.
 * Directories are ordered by preference — sandboxed toolchain venv first,
 * then pipx venvs as fallback.
 */
function resolveAnsibleBinDir(ansibleBinaryPath: string, ctx?: ToolchainContext): string[] {
  const dirs: string[] = [];
  const home = os.homedir();

  // 1. Toolchain sandbox venv (preferred — fully controlled by DojOps)
  const tc = ctx ?? globalToolchainCtx();
  dirs.push(path.join(tc.dir, "venvs", "ansible", "bin"));

  // 2. Directory of the resolved ansible binary (follows symlinks)
  if (ansibleBinaryPath && ansibleBinaryPath !== "ansible") {
    dirs.push(path.dirname(ansibleBinaryPath));
    try {
      const realPath = fs.realpathSync(ansibleBinaryPath);
      if (realPath !== ansibleBinaryPath) {
        dirs.push(path.dirname(realPath));
      }
    } catch {
      /* ignore */
    }
  }

  // 3. pipx venv internals (fallback)
  dirs.push(path.join(home, ".local", "share", "pipx", "venvs", "ansible", "bin"));
  dirs.push(path.join(home, ".local", "pipx", "venvs", "ansible", "bin"));

  // 4. pipx exposed scripts
  dirs.push(path.join(home, ".local", "bin"));

  return dirs;
}

/**
 * Find the first working companion binary across search directories.
 * A "working" binary exists on disk and has a valid shebang (interpreter exists).
 */
function findWorkingCompanion(name: string, searchDirs: string[]): string | undefined {
  for (const dir of searchDirs) {
    const candidate = path.join(dir, name);
    try {
      if (!fs.existsSync(candidate)) continue;
      if (!isVenvScriptWorking(candidate)) continue;
      return candidate;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/** Create a symlink, removing any existing file at destPath first. Best-effort (silent on failure). */
function forceSymlink(sourcePath: string, destPath: string): void {
  try {
    try {
      fs.unlinkSync(destPath);
    } catch {
      /* may not exist */
    }
    fs.symlinkSync(sourcePath, destPath);
  } catch {
    /* best-effort — skip on failure */
  }
}

/**
 * Symlink ansible companion binaries (ansible-playbook, ansible-galaxy, etc.)
 * from their source location into the toolchain bin directory.
 * Searches multiple possible source directories, validating that Python scripts
 * have working shebangs (not broken by directory migrations).
 */
function symlinkAnsibleCompanions(ansibleBinaryPath: string, ctx?: ToolchainContext): void {
  const tc = ctx ?? globalToolchainCtx();
  const searchDirs = resolveAnsibleBinDir(ansibleBinaryPath, ctx);

  for (const companion of ANSIBLE_COMPANIONS) {
    const sourcePath = findWorkingCompanion(companion, searchDirs);
    if (!sourcePath) continue;
    forceSymlink(sourcePath, path.join(tc.binDir, companion));
  }
}

/**
 * Ensure ~/.local/bin/ (pipx's default script directory) is on process.env.PATH.
 * After pipx install, binaries are placed there but the Node process may not
 * have it in PATH (e.g., added via .bashrc which isn't sourced by child processes).
 */
function ensurePipxBinOnPath(): void {
  const pipxBinDir = path.join(os.homedir(), ".local", "bin");
  if (process.env.PATH && !process.env.PATH.includes(pipxBinDir)) {
    process.env.PATH = `${pipxBinDir}${path.delimiter}${process.env.PATH}`;
  }
}

function findInstalledBinary(name: string): string {
  try {
    const result = runBin("which", [name], {
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }) as string;
    return result.trim();
  } catch {
    return name;
  }
}

function registerPipTool(
  tool: SystemTool,
  binaryPath: string,
  ctx?: ToolchainContext,
): InstalledTool {
  const installed: InstalledTool = {
    name: tool.name,
    version: tool.latestVersion,
    installedAt: new Date().toISOString(),
    size: 0,
    binaryPath,
  };

  const registry = loadToolchainRegistry(ctx);
  registry.tools = registry.tools.filter((t) => t.name !== tool.name);
  registry.tools.push(installed);
  saveToolchainRegistry(registry, ctx);

  return installed;
}

/**
 * Install a tool that requires building from source.
 * Dispatches to tool-specific handlers (like pipx → installPipTool).
 */
async function installFromSource(
  tool: SystemTool,
  version?: string,
  ctx?: ToolchainContext,
): Promise<InstalledTool> {
  if (tool.name === "whisper-cpp") {
    return installWhisperCpp(tool, version, ctx);
  }
  throw new Error(`No source install handler for ${tool.name}`);
}

/** URL template for whisper.cpp model downloads from Hugging Face. */
const WHISPER_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

function assertBuildPrerequisites(): void {
  const missing: string[] = [];
  if (!commandExists("git")) missing.push("git");
  if (!commandExists("cmake")) missing.push("cmake");
  if (!commandExists("make") && !commandExists("ninja")) missing.push("make or ninja");
  if (!commandExists("cc") && !commandExists("gcc") && !commandExists("clang")) {
    missing.push("cc/gcc/clang (C compiler)");
  }
  if (missing.length === 0) return;
  throw new Error(
    `Cannot build whisper.cpp — missing: ${missing.join(", ")}.\n` +
      "Install build tools:\n" +
      "  macOS: xcode-select --install && brew install cmake\n" +
      "  Linux: sudo apt install build-essential cmake git",
  );
}

/**
 * Install whisper.cpp by cloning the repo and building from source.
 *
 * Uses cmake with --prefix to install ALL binaries and shared libraries
 * (libwhisper, libggml, libggml-base, libggml-cpu, etc.) into the
 * toolchain directory. A wrapper script sets LD_LIBRARY_PATH so the
 * linker finds everything without system-level install.
 *
 * Steps:
 * 1. Validate build prerequisites (git, cmake, cc)
 * 2. Clone a shallow copy of the release tag
 * 3. Build + install via cmake (--prefix targets toolchain dir)
 * 4. Create wrapper script for LD_LIBRARY_PATH
 * 5. Download the default model to ~/.dojops/voice/
 */
async function installWhisperCpp(
  tool: SystemTool,
  version?: string,
  ctx?: ToolchainContext,
): Promise<InstalledTool> {
  const tc = ctx ?? globalToolchainCtx();
  const ver = version ?? tool.latestVersion;
  ensureToolchainDir(ctx);

  assertBuildPrerequisites();

  // Clone to temp directory
  const buildDir = path.join(os.tmpdir(), `dojops-whisper-build-${Date.now()}`);
  try {
    runBin(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        `v${ver}`,
        "https://github.com/ggerganov/whisper.cpp.git",
        buildDir,
      ],
      { timeout: 120_000, stdio: "pipe" },
    );

    // Configure with cmake — install prefix targets the toolchain directory
    const cpuCount = Math.max(1, os.cpus().length);
    runBin(
      "cmake",
      ["-B", "build", "-DCMAKE_BUILD_TYPE=Release", `-DCMAKE_INSTALL_PREFIX=${tc.dir}`],
      {
        timeout: 60_000,
        stdio: "pipe",
        cwd: buildDir,
      },
    );

    // Build
    runBin("cmake", ["--build", "build", "--config", "Release", "-j", String(cpuCount)], {
      timeout: 300_000,
      stdio: "pipe",
      cwd: buildDir,
    });

    // Install — cmake copies binaries to bin/, libraries to lib/
    runBin("cmake", ["--install", "build"], {
      timeout: 60_000,
      stdio: "pipe",
      cwd: buildDir,
    });

    // cmake --install puts binary at <prefix>/bin/whisper-cli
    // and all shared libs at <prefix>/lib/
    const installedBin = path.join(tc.binDir, "whisper-cli");
    if (!fs.existsSync(installedBin)) {
      // Fallback: check for 'main' binary name (older versions)
      const mainBin = path.join(tc.binDir, "main");
      if (fs.existsSync(mainBin)) {
        fs.renameSync(mainBin, installedBin);
      } else {
        throw new Error("cmake install completed but whisper-cli binary not found in " + tc.binDir);
      }
    }

    // Rename the real binary and create a wrapper that sets library path
    const libDir = path.join(tc.dir, "lib");
    const actualBin = path.join(tc.binDir, "whisper-cli.bin");
    fs.renameSync(installedBin, actualBin);
    chmodExecutable(actualBin);

    const isLinux = process.platform === "linux";
    const ldVar = isLinux ? "LD_LIBRARY_PATH" : "DYLD_LIBRARY_PATH";
    const wrapper = [
      "#!/bin/sh",
      `export ${ldVar}="${libDir}\${${ldVar}:+:$${ldVar}}"`,
      `exec "${actualBin}" "$@"`,
      "",
    ].join("\n");
    fs.writeFileSync(installedBin, wrapper, { mode: 0o755 });

    // Register in toolchain
    const stat = fs.statSync(installedBin);
    const installed: InstalledTool = {
      name: tool.name,
      version: ver,
      installedAt: new Date().toISOString(),
      size: stat.size,
      binaryPath: installedBin,
    };

    const registry = loadToolchainRegistry(ctx);
    registry.tools = registry.tools.filter((t) => t.name !== tool.name);
    registry.tools.push(installed);
    saveToolchainRegistry(registry, ctx);

    // Download default model (non-fatal but warn on failure)
    try {
      await downloadWhisperModel();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `Warning: whisper model download failed: ${msg}\n` +
          `Download manually: curl -L -o ~/.dojops/voice/ggml-base.en.bin ${WHISPER_MODEL_URL}`,
      );
    }

    return installed;
  } finally {
    try {
      fs.rmSync(buildDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Download the default whisper.cpp model (ggml-base.en.bin) to ~/.dojops/voice/.
 * Always uses the global location — models are large (~142MB) and shared across projects.
 * Skips if model already exists.
 */
async function downloadWhisperModel(): Promise<void> {
  const voiceDir = path.join(os.homedir(), ".dojops", "voice");
  const modelPath = path.join(voiceDir, "ggml-base.en.bin");

  if (fs.existsSync(modelPath)) return; // Already downloaded

  fs.mkdirSync(voiceDir, { recursive: true });

  const tmpFile = await downloadToTemp(WHISPER_MODEL_URL);
  fs.copyFileSync(tmpFile, modelPath);
  try {
    fs.unlinkSync(tmpFile);
  } catch {
    /* ignore */
  }
}

/**
 * Remove a system tool from the toolchain.
 */
export function removeSystemTool(name: string, ctx?: ToolchainContext): boolean {
  const tc = ctx ?? globalToolchainCtx();
  const registry = loadToolchainRegistry(ctx);
  const entry = registry.tools.find((t) => t.name === name);
  if (!entry) return false;

  // Delete binary (or symlink)
  const binPath = path.join(tc.binDir, path.basename(entry.binaryPath));
  try {
    fs.unlinkSync(binPath);
  } catch {
    /* ignore if already gone */
  }

  // Clean up venv if this was a venv-installed tool (e.g. ansible)
  const venvDir = path.join(tc.dir, "venvs", name);
  try {
    fs.rmSync(venvDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Update registry
  registry.tools = registry.tools.filter((t) => t.name !== name);
  saveToolchainRegistry(registry, ctx);

  return true;
}

/**
 * Remove all toolchain tools and clear the registry.
 */
export function cleanAllToolchain(ctx?: ToolchainContext): { removed: string[] } {
  const tc = ctx ?? globalToolchainCtx();
  const registry = loadToolchainRegistry(ctx);
  const removed = registry.tools.map((t) => t.name);

  // Delete all binaries
  if (fs.existsSync(tc.binDir)) {
    const entries = fs.readdirSync(tc.binDir);
    for (const entry of entries) {
      try {
        fs.unlinkSync(path.join(tc.binDir, entry));
      } catch {
        /* ignore */
      }
    }
  }

  // Remove venvs directory
  const venvsDir = path.join(tc.dir, "venvs");
  try {
    fs.rmSync(venvsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Remove sandboxed npm node_modules
  try {
    fs.rmSync(tc.nodeModules, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  // Clear registry
  saveToolchainRegistry({ tools: [], updatedAt: "" }, ctx);

  return { removed };
}

/**
 * Run a tool's verify command and return the version output.
 * Returns undefined if verification fails.
 */
export function verifyTool(tool: SystemTool, ctx?: ToolchainContext): string | undefined {
  const tc = ctx ?? globalToolchainCtx();
  try {
    const [cmd, ...args] = tool.verifyCommand;
    const result = runBin(cmd, args, {
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${tc.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    }) as string;
    return result.trim().split("\n")[0];
  } catch {
    return undefined;
  }
}

/**
 * Create an OnBinaryMissing handler that auto-installs tools via the toolchain.
 * Returns a callback suitable for passing to DopsRuntimeV2 / module-registry options.
 */
export function createAutoInstallHandler(
  log?: (message: string) => void,
): (binaryName: string) => Promise<boolean> {
  return async (binaryName: string): Promise<boolean> => {
    const skillName = BINARY_TO_SYSTEM_TOOL[binaryName];
    if (!skillName) return false;

    const tool = findSystemTool(skillName);
    if (!tool) return false;

    try {
      log?.(`Auto-installing ${skillName} for verification...`);
      const installed = await installSystemTool(tool);
      prependToolchainBinToPath();

      // For pipx/venv tools, also add the binary's parent dir to PATH
      // (e.g., ~/.local/bin/ for pipx installs)
      if (installed.binaryPath && installed.binaryPath !== tool.binaryName) {
        const binDir = path.dirname(installed.binaryPath);
        if (binDir && binDir !== "." && !process.env.PATH?.includes(binDir)) {
          process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;
        }
      }

      log?.(`${skillName} installed successfully`);
      return true;
    } catch {
      log?.(`Failed to auto-install ${skillName}`);
      return false;
    }
  };
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
