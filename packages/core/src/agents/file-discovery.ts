/**
 * Auto-discovers DevOps configuration files in a project directory.
 *
 * Scans for common DevOps file patterns: CI/CD workflows, Dockerfiles,
 * IaC configs, shell scripts, K8s manifests, Helm charts, etc.
 *
 * Used by the DevSecOps reviewer to automatically find files to validate.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { loadIgnorePatterns, isIgnored } from "./dojopsignore";

/** Discovered DevOps config file with its path and content. */
export interface DiscoveredFile {
  /** Relative path from project root */
  path: string;
  /** File content (UTF-8) */
  content: string;
}

/** Directories to skip when scanning. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".terraform",
  "__pycache__",
  ".venv",
  "vendor",
  ".dojops",
]);

/** Maximum file size to read (256 KB — config files shouldn't be larger). */
const MAX_FILE_SIZE = 256 * 1024;

/** Maximum number of files to discover (prevents runaway scans). */
const MAX_FILES = 100;

/** File patterns to discover, in priority order. */
const DISCOVERY_PATTERNS: { dir?: string; names?: string[]; extensions?: string[] }[] = [
  // CI/CD
  { dir: ".github/workflows", extensions: [".yml", ".yaml"] },
  { dir: ".github/actions", names: ["action.yml", "action.yaml"] },
  { names: [".gitlab-ci.yml", ".gitlab-ci.yaml"] },
  { names: ["Jenkinsfile"] },
  { names: [".circleci/config.yml"] },
  // Containers
  { names: ["Dockerfile"], extensions: [".dockerfile"] },
  { names: ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] },
  // IaC
  { extensions: [".tf"] },
  // K8s & Helm
  { names: ["Chart.yaml", "Chart.yml"] },
  { dir: "k8s", extensions: [".yml", ".yaml"] },
  { dir: "kubernetes", extensions: [".yml", ".yaml"] },
  { dir: "manifests", extensions: [".yml", ".yaml"] },
  // Shell
  { extensions: [".sh", ".bash"] },
  // Monitoring
  { names: ["prometheus.yml", "prometheus.yaml"] },
  // Systemd
  { extensions: [".service", ".timer", ".socket"] },
  // Makefile
  { names: ["Makefile"] },
  // Ansible
  { dir: "ansible", extensions: [".yml", ".yaml"] },
  { names: ["playbook.yml", "playbook.yaml", "site.yml", "site.yaml"] },
  // Nginx
  { names: ["nginx.conf"] },
  { dir: "nginx", extensions: [".conf"] },
];

/** Collect named files from root for all patterns. */
function collectNamedFiles(
  projectRoot: string,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[],
): void {
  for (const pattern of DISCOVERY_PATTERNS) {
    if (files.length >= MAX_FILES) break;
    if (!pattern.names) continue;
    for (const name of pattern.names) {
      if (files.length >= MAX_FILES) break;
      tryAddFile(path.join(projectRoot, name), name, files, seen, ignorePatterns);
    }
  }
}

/** Scan all pattern-defined directories. */
function collectDirectoryFiles(
  projectRoot: string,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[],
): void {
  for (const pattern of DISCOVERY_PATTERNS) {
    if (files.length >= MAX_FILES) break;
    if (!pattern.dir) continue;
    const dirPath = path.join(projectRoot, pattern.dir);
    scanDirectory(
      dirPath,
      pattern.dir,
      pattern.extensions,
      pattern.names,
      files,
      seen,
      ignorePatterns,
    );
  }
}

/** Scan root for extension-only patterns (no dir specified). */
function collectRootExtensionFiles(
  projectRoot: string,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[],
): void {
  for (const pattern of DISCOVERY_PATTERNS) {
    if (files.length >= MAX_FILES) break;
    if (pattern.extensions && !pattern.dir) {
      scanRootForExtensions(projectRoot, pattern.extensions, files, seen, ignorePatterns);
    }
  }
}

/**
 * Discover DevOps configuration files in a project.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns Array of discovered files with relative paths and content
 */
export function discoverDevOpsFiles(projectRoot: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();
  const ignorePatterns = loadIgnorePatterns(projectRoot);

  collectNamedFiles(projectRoot, files, seen, ignorePatterns);
  collectDirectoryFiles(projectRoot, files, seen, ignorePatterns);
  collectRootExtensionFiles(projectRoot, files, seen, ignorePatterns);
  scanDockerfileVariants(projectRoot, files, seen, ignorePatterns);

  return files;
}

function tryAddFile(
  absPath: string,
  relativePath: string,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[] = [],
): void {
  if (seen.has(relativePath) || files.length >= MAX_FILES) return;
  if (ignorePatterns.length > 0 && isIgnored(relativePath, ignorePatterns)) return;
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE || stat.size === 0) return;
    const content = fs.readFileSync(absPath, "utf-8");
    files.push({ path: relativePath, content });
    seen.add(relativePath);
  } catch {
    // File doesn't exist or unreadable — skip
  }
}

/** Handle a subdirectory entry during directory scanning. */
function handleSubdirectory(
  entryAbsPath: string,
  entryRelPath: string,
  extensions: string[] | undefined,
  names: string[] | undefined,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[],
): void {
  if (names) {
    for (const name of names) {
      tryAddFile(
        path.join(entryAbsPath, name),
        `${entryRelPath}/${name}`,
        files,
        seen,
        ignorePatterns,
      );
    }
  }
  if (extensions) {
    scanDirectory(entryAbsPath, entryRelPath, extensions, undefined, files, seen, ignorePatterns);
  }
}

interface ScanContext {
  extensions: string[] | undefined;
  names: string[] | undefined;
  files: DiscoveredFile[];
  seen: Set<string>;
  ignorePatterns: string[];
}

/** Handle a file entry during directory scanning. */
function handleFileEntry(
  entryAbsPath: string,
  entryRelPath: string,
  entryName: string,
  ctx: ScanContext,
): void {
  if (ctx.extensions) {
    const ext = path.extname(entryName).toLowerCase();
    if (ctx.extensions.includes(ext)) {
      tryAddFile(entryAbsPath, entryRelPath, ctx.files, ctx.seen, ctx.ignorePatterns);
    }
  }
  if (ctx.names?.includes(entryName)) {
    tryAddFile(entryAbsPath, entryRelPath, ctx.files, ctx.seen, ctx.ignorePatterns);
  }
}

function scanDirectory(
  dirAbsPath: string,
  dirRelPath: string,
  extensions: string[] | undefined,
  names: string[] | undefined,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[] = [],
): void {
  try {
    const entries = fs.readdirSync(dirAbsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;

      const entryRelPath = `${dirRelPath}/${entry.name}`;
      const entryAbsPath = path.join(dirAbsPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        handleSubdirectory(
          entryAbsPath,
          entryRelPath,
          extensions,
          names,
          files,
          seen,
          ignorePatterns,
        );
        continue;
      }

      if (!entry.isFile()) continue;
      handleFileEntry(entryAbsPath, entryRelPath, entry.name, {
        extensions,
        names,
        files,
        seen,
        ignorePatterns,
      });
    }
  } catch {
    // Directory doesn't exist — skip
  }
}

function scanRootForExtensions(
  projectRoot: string,
  extensions: string[],
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[] = [],
): void {
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        tryAddFile(path.join(projectRoot, entry.name), entry.name, files, seen, ignorePatterns);
      }
    }
  } catch {
    // Can't read root — skip
  }
}

function scanDockerfileVariants(
  projectRoot: string,
  files: DiscoveredFile[],
  seen: Set<string>,
  ignorePatterns: string[] = [],
): void {
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (!entry.isFile()) continue;
      if (entry.name.startsWith("Dockerfile.")) {
        tryAddFile(path.join(projectRoot, entry.name), entry.name, files, seen, ignorePatterns);
      }
    }
  } catch {
    // skip
  }
}
