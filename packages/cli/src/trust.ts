import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

export interface TrustDecision {
  contentHash: string;
  trustedAt: string;
  configs: { agents: string[]; mcpServers: string[]; skills: string[] };
}

export interface TrustCheck {
  trusted: boolean;
  hashChanged: boolean;
  configs: { agents: string[]; mcpServers: string[]; skills: string[] };
}

function trustStorePath(): string {
  return path.join(os.homedir(), ".dojops", "trusted-folders.json");
}

function loadTrustStore(): Record<string, TrustDecision> {
  try {
    return JSON.parse(fs.readFileSync(trustStorePath(), "utf-8")) as Record<string, TrustDecision>;
  } catch {
    return {};
  }
}

function saveTrustStore(store: Record<string, TrustDecision>): void {
  const dir = path.dirname(trustStorePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(trustStorePath(), JSON.stringify(store, null, 2) + "\n");
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => !f.startsWith("."))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Discover workspace configs: custom agents, MCP servers, custom skills.
 */
export function discoverWorkspaceConfigs(projectDir: string): TrustCheck["configs"] {
  const dojopsDir = path.join(projectDir, ".dojops");
  return {
    agents: listFiles(path.join(dojopsDir, "agents")),
    mcpServers: fs.existsSync(path.join(dojopsDir, "mcp.json")) ? ["mcp.json"] : [],
    skills: listFiles(path.join(dojopsDir, "skills")),
  };
}

/**
 * SHA-256 of sorted concatenation of agent files, mcp.json, and skill files.
 */
export function computeConfigHash(projectDir: string): string {
  const dojopsDir = path.join(projectDir, ".dojops");
  const hash = crypto.createHash("sha256");
  const parts: string[] = [];

  // Agents
  const agentsDir = path.join(dojopsDir, "agents");
  if (fs.existsSync(agentsDir)) {
    for (const f of listFiles(agentsDir)) {
      try {
        parts.push(`agent:${f}:${fs.readFileSync(path.join(agentsDir, f), "utf-8")}`);
      } catch {
        // skip unreadable files
      }
    }
  }

  // MCP config
  const mcpPath = path.join(dojopsDir, "mcp.json");
  if (fs.existsSync(mcpPath)) {
    try {
      parts.push(`mcp:${fs.readFileSync(mcpPath, "utf-8")}`);
    } catch {
      // skip
    }
  }

  // Skills
  const skillsDir = path.join(dojopsDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const f of listFiles(skillsDir)) {
      try {
        const skillPath = path.join(skillsDir, f);
        if (fs.statSync(skillPath).isDirectory()) {
          const inner = listFiles(skillPath);
          for (const sf of inner) {
            parts.push(`skill:${f}/${sf}:${fs.readFileSync(path.join(skillPath, sf), "utf-8")}`);
          }
        } else {
          parts.push(`skill:${f}:${fs.readFileSync(skillPath, "utf-8")}`);
        }
      } catch {
        // skip
      }
    }
  }

  parts.sort();
  for (const p of parts) hash.update(p);
  return hash.digest("hex");
}

/**
 * Check whether a folder is trusted. Returns trust status plus what configs exist.
 */
export function isFolderTrusted(projectDir: string): TrustCheck {
  const configs = discoverWorkspaceConfigs(projectDir);
  const hasConfigs =
    configs.agents.length > 0 || configs.mcpServers.length > 0 || configs.skills.length > 0;

  if (!hasConfigs) {
    return { trusted: true, hashChanged: false, configs };
  }

  const store = loadTrustStore();
  const absDir = path.resolve(projectDir);
  const decision = store[absDir];

  if (!decision) {
    return { trusted: false, hashChanged: false, configs };
  }

  const currentHash = computeConfigHash(projectDir);
  if (currentHash !== decision.contentHash) {
    return { trusted: false, hashChanged: true, configs };
  }

  return { trusted: true, hashChanged: false, configs };
}

/**
 * Mark a folder as trusted by recording its config hash.
 */
export function trustFolder(projectDir: string): void {
  const store = loadTrustStore();
  const absDir = path.resolve(projectDir);
  const configs = discoverWorkspaceConfigs(projectDir);

  store[absDir] = {
    contentHash: computeConfigHash(projectDir),
    trustedAt: new Date().toISOString(),
    configs,
  };

  saveTrustStore(store);
}

/**
 * Remove trust for a folder. Returns true if an entry was removed.
 */
export function untrustFolder(projectDir: string): boolean {
  const store = loadTrustStore();
  const absDir = path.resolve(projectDir);
  if (!(absDir in store)) return false;
  delete store[absDir];
  saveTrustStore(store);
  return true;
}

/**
 * List all trusted folders with their trust decisions.
 */
export function listTrustedFolders(): Record<string, TrustDecision> {
  return loadTrustStore();
}
