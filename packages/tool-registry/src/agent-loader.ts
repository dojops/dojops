import * as fs from "fs";
import * as path from "path";
import { CustomAgentConfig, parseAgentReadme } from "./agent-parser";

const AGENTS_DIR_NAME = "agents";
const README_FILE = "README.md";

export interface CustomAgentEntry {
  config: CustomAgentConfig;
  agentDir: string;
  location: "global" | "project";
}

function getGlobalAgentsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return path.join(home, ".dojops", AGENTS_DIR_NAME);
}

function getProjectAgentsDir(projectPath: string): string {
  return path.join(projectPath, ".dojops", AGENTS_DIR_NAME);
}

function loadAgentFromDir(
  agentDir: string,
  location: "global" | "project",
): CustomAgentEntry | null {
  const readmePath = path.join(agentDir, README_FILE);
  if (!fs.existsSync(readmePath)) return null;

  let content: string;
  try {
    content = fs.readFileSync(readmePath, "utf-8");
  } catch {
    return null;
  }

  const dirName = path.basename(agentDir);
  const config = parseAgentReadme(content, dirName);
  if (!config) return null;

  return { config, agentDir, location };
}

/**
 * Discovers custom agents from global (~/.dojops/agents/) and project (.dojops/agents/) directories.
 * Project agents override global agents by directory name.
 */
export function discoverCustomAgents(projectPath?: string): CustomAgentEntry[] {
  const agents = new Map<string, CustomAgentEntry>();

  // 1. Global agents
  const globalDir = getGlobalAgentsDir();
  if (fs.existsSync(globalDir)) {
    try {
      const entries = fs.readdirSync(globalDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentDir = path.join(globalDir, entry.name);
        const agent = loadAgentFromDir(agentDir, "global");
        if (agent) {
          agents.set(entry.name, agent);
        }
      }
    } catch {
      // Silently skip unreadable global dir
    }
  }

  // 2. Project agents (override global)
  if (projectPath) {
    const projectDir = getProjectAgentsDir(projectPath);
    if (fs.existsSync(projectDir)) {
      try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const agentDir = path.join(projectDir, entry.name);
          const agent = loadAgentFromDir(agentDir, "project");
          if (agent) {
            agents.set(entry.name, agent);
          }
        }
      } catch {
        // Silently skip unreadable project dir
      }
    }
  }

  return Array.from(agents.values());
}
