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

/** Path to the vault key file (shared with vault.ts). */
function vaultKeyPath(): string {
  return path.join(os.homedir(), ".dojops", "vault-key");
}

/** Read the vault key for HMAC signing. Returns null if unavailable. */
function getSigningKey(): string | null {
  try {
    const key = fs.readFileSync(vaultKeyPath(), "utf-8").trim();
    return key.length >= 32 ? key : null;
  } catch {
    return null;
  }
}

/** Compute HMAC-SHA256 of the trust store data. */
function computeStoreHmac(data: string, key: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

/**
 * G-47: Load trust store with signature verification.
 * If the signature is invalid, treats the store as empty (untrusted) and warns.
 * If no signing key is available, skips verification (graceful degradation).
 */
function loadTrustStore(): Record<string, TrustDecision> {
  try {
    const raw = fs.readFileSync(trustStorePath(), "utf-8");
    const parsed = JSON.parse(raw);

    // Check if this is a signed store (has _signature + data)
    if (parsed._signature && parsed.data) {
      const signingKey = getSigningKey();
      if (signingKey) {
        const dataStr = JSON.stringify(parsed.data);
        const expectedHmac = computeStoreHmac(dataStr, signingKey);
        if (
          !crypto.timingSafeEqual(
            Buffer.from(parsed._signature, "hex"),
            Buffer.from(expectedHmac, "hex"),
          )
        ) {
          console.warn(
            "[trust] Trust store signature invalid — file may have been tampered with. Treating as empty.",
          );
          return {};
        }
      }
      // Signature valid or no signing key — return data
      return parsed.data as Record<string, TrustDecision>;
    }

    // Legacy unsigned store — migrate on next save
    return parsed as Record<string, TrustDecision>;
  } catch {
    return {};
  }
}

/**
 * G-47: Save trust store with HMAC signature.
 * If vault key is available, signs the data. Otherwise saves unsigned.
 */
function saveTrustStore(store: Record<string, TrustDecision>): void {
  const dir = path.dirname(trustStorePath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const signingKey = getSigningKey();
  if (signingKey) {
    const dataStr = JSON.stringify(store);
    const signature = computeStoreHmac(dataStr, signingKey);
    const signed = { _signature: signature, data: store };
    fs.writeFileSync(trustStorePath(), JSON.stringify(signed, null, 2) + "\n");
  } else {
    // No vault key — save unsigned (graceful degradation)
    fs.writeFileSync(trustStorePath(), JSON.stringify(store, null, 2) + "\n");
  }
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
