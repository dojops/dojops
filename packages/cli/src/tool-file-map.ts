import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Map tool names to their likely existing file paths.
 * Used to detect existing configs and pass as context for update workflows.
 */
export const TOOL_FILE_MAP: Record<string, string[]> = {
  dockerfile: ["Dockerfile", "Dockerfile.dev", "Dockerfile.prod"],
  "docker-compose": ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"],
  "github-actions": [".github/workflows/ci.yml", ".github/workflows/ci.yaml"],
  "gitlab-ci": [".gitlab-ci.yml", ".gitlab-ci.yaml"],
  jenkinsfile: ["Jenkinsfile"],
  terraform: ["main.tf"],
  nginx: ["nginx.conf"],
  makefile: ["Makefile"],
  prometheus: ["prometheus.yml", "prometheus.yaml"],
};

/**
 * Reads existing config file content for a given tool, if found.
 * Returns the content string and the file path, or undefined if no file exists.
 */
export function readExistingToolFile(
  toolName: string,
  cwd: string,
): { content: string; filePath: string } | undefined {
  const filePaths = TOOL_FILE_MAP[toolName];
  if (!filePaths) return undefined;

  for (const fp of filePaths) {
    const absPath = path.resolve(cwd, fp);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size <= 50 * 1024) {
        const content = fs.readFileSync(absPath, "utf-8");
        return { content, filePath: fp };
      }
    } catch {
      // File doesn't exist — try next
    }
  }
  return undefined;
}
