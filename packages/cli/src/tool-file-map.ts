import * as fs from "node:fs";
import * as path from "node:path";

const MAX_FILE_SIZE = 50 * 1024; // 50 KB

/**
 * Map tool names to their likely existing file paths (single-file tools).
 * Used to detect existing configs and pass as context for update workflows.
 */
export const TOOL_FILE_MAP: Record<string, string[]> = {
  dockerfile: ["Dockerfile", "Dockerfile.dev", "Dockerfile.prod"],
  "docker-compose": ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"],
  "gitlab-ci": [".gitlab-ci.yml", ".gitlab-ci.yaml"],
  jenkinsfile: ["Jenkinsfile"],
  terraform: [
    "main.tf",
    "variables.tf",
    "outputs.tf",
    "providers.tf",
    "terraform.tf",
    "locals.tf",
    "backend.tf",
  ],
  nginx: ["nginx.conf"],
  makefile: ["Makefile"],
  prometheus: ["prometheus.yml", "prometheus.yaml"],
};

/**
 * Multi-file tools: directories to scan for existing config files.
 * All .yml/.yaml files in these dirs are read and returned as a combined block.
 */
const TOOL_SCAN_DIRS: Record<string, { dirs: string[]; extensions: string[] }> = {
  "github-actions": {
    dirs: [".github/workflows", ".github/actions"],
    extensions: [".yml", ".yaml"],
  },
};

/** Recursively collect files with given extensions from a directory. */
function collectFiles(dir: string, extensions: string[], maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions, maxDepth, depth + 1));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Read ALL existing config files for a multi-file tool.
 * Returns a formatted multi-file block with file path headers, or undefined if no files found.
 */
function readMultiFileToolContent(
  toolName: string,
  cwd: string,
): { content: string; filePath: string } | undefined {
  const scanConfig = TOOL_SCAN_DIRS[toolName];
  if (!scanConfig) return undefined;

  const sections: string[] = [];
  let firstFile: string | undefined;

  for (const dir of scanConfig.dirs) {
    const absDir = path.resolve(cwd, dir);
    const files = collectFiles(absDir, scanConfig.extensions);
    for (const absPath of files.sort()) {
      try {
        const stat = fs.statSync(absPath);
        if (stat.size > MAX_FILE_SIZE) continue;
        const content = fs.readFileSync(absPath, "utf-8");
        const relPath = path.relative(cwd, absPath);
        if (!firstFile) firstFile = relPath;
        sections.push(`--- ${relPath} ---\n${content}`);
      } catch {
        // Skip unreadable files
      }
    }
  }

  if (sections.length === 0) return undefined;
  return { content: sections.join("\n\n"), filePath: firstFile! };
}

/**
 * Reads existing config file content for a given tool, if found.
 * For multi-file tools (e.g. github-actions), reads ALL relevant files as a combined block.
 * Returns the content string and the file path, or undefined if no file exists.
 */
export function readExistingToolFile(
  toolName: string,
  cwd: string,
): { content: string; filePath: string } | undefined {
  // Multi-file tools: scan directories and return all files
  const multiResult = readMultiFileToolContent(toolName, cwd);
  if (multiResult) return multiResult;

  // Single-file tools: return first match
  const filePaths = TOOL_FILE_MAP[toolName];
  if (!filePaths) return undefined;

  for (const fp of filePaths) {
    const absPath = path.resolve(cwd, fp);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size <= MAX_FILE_SIZE) {
        const content = fs.readFileSync(absPath, "utf-8");
        return { content, filePath: fp };
      }
    } catch {
      // File doesn't exist — try next
    }
  }
  return undefined;
}
