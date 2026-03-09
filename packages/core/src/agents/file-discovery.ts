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

/**
 * Discover DevOps configuration files in a project.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns Array of discovered files with relative paths and content
 */
export function discoverDevOpsFiles(projectRoot: string): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();

  // First, check specific named files at root level
  for (const pattern of DISCOVERY_PATTERNS) {
    if (files.length >= MAX_FILES) break;

    if (pattern.names) {
      for (const name of pattern.names) {
        if (files.length >= MAX_FILES) break;
        const filePath = path.join(projectRoot, name);
        tryAddFile(filePath, name, files, seen);
      }
    }
  }

  // Then, scan directories and extensions
  for (const pattern of DISCOVERY_PATTERNS) {
    if (files.length >= MAX_FILES) break;

    if (pattern.dir) {
      const dirPath = path.join(projectRoot, pattern.dir);
      scanDirectory(dirPath, pattern.dir, pattern.extensions, pattern.names, files, seen);
    }
  }

  // Scan root for extension matches (Dockerfile.*, *.tf, *.sh, etc.)
  for (const pattern of DISCOVERY_PATTERNS) {
    if (files.length >= MAX_FILES) break;
    if (pattern.extensions && !pattern.dir) {
      scanRootForExtensions(projectRoot, pattern.extensions, files, seen);
    }
  }

  // Scan root for Dockerfile.* variants
  scanDockerfileVariants(projectRoot, files, seen);

  return files;
}

function tryAddFile(
  absPath: string,
  relativePath: string,
  files: DiscoveredFile[],
  seen: Set<string>,
): void {
  if (seen.has(relativePath) || files.length >= MAX_FILES) return;
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

function scanDirectory(
  dirAbsPath: string,
  dirRelPath: string,
  extensions: string[] | undefined,
  names: string[] | undefined,
  files: DiscoveredFile[],
  seen: Set<string>,
): void {
  try {
    const entries = fs.readdirSync(dirAbsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;

      const entryRelPath = `${dirRelPath}/${entry.name}`;
      const entryAbsPath = path.join(dirAbsPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        // Recurse one level for action subdirs (.github/actions/*/action.yml)
        if (names) {
          for (const name of names) {
            tryAddFile(path.join(entryAbsPath, name), `${entryRelPath}/${name}`, files, seen);
          }
        }
        if (extensions) {
          scanDirectory(entryAbsPath, entryRelPath, extensions, undefined, files, seen);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      // Check extension match
      if (extensions) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          tryAddFile(entryAbsPath, entryRelPath, files, seen);
        }
      }

      // Check name match
      if (names && names.includes(entry.name)) {
        tryAddFile(entryAbsPath, entryRelPath, files, seen);
      }
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
): void {
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        tryAddFile(path.join(projectRoot, entry.name), entry.name, files, seen);
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
): void {
  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (!entry.isFile()) continue;
      if (entry.name.startsWith("Dockerfile.")) {
        tryAddFile(path.join(projectRoot, entry.name), entry.name, files, seen);
      }
    }
  } catch {
    // skip
  }
}
