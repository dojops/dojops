import * as fs from "node:fs";
import * as path from "node:path";
import { CustomAgentConfig, parseAgentReadme } from "./agent-parser";

const AGENTS_DIR_NAME = "agents";
const README_FILE = "README.md";
const MAX_README_SIZE = 65_536; // 64KB — same cap as tool manifests

export interface CustomAgentEntry {
  config: CustomAgentConfig;
  agentDir: string;
  location: "global" | "project";
}

function getGlobalAgentsDir(): string | null {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) return null;
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
    const stat = fs.statSync(readmePath);
    if (stat.size > MAX_README_SIZE) return null;
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
/** Scan a directory for agent subdirectories and load them into the map. */
function loadAgentsFromDirectory(
  baseDir: string,
  location: "global" | "project",
  agents: Map<string, CustomAgentEntry>,
): void {
  if (!fs.existsSync(baseDir)) return;
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agentDir = path.join(baseDir, entry.name);
      const agent = loadAgentFromDir(agentDir, location);
      if (agent) agents.set(entry.name, agent);
    }
  } catch {
    // Silently skip unreadable directory
  }
}

export function discoverCustomAgents(projectPath?: string): CustomAgentEntry[] {
  const agents = new Map<string, CustomAgentEntry>();

  const globalDir = getGlobalAgentsDir();
  if (globalDir) loadAgentsFromDirectory(globalDir, "global", agents);

  if (projectPath) {
    loadAgentsFromDirectory(getProjectAgentsDir(projectPath), "project", agents);
  }

  return Array.from(agents.values());
}
