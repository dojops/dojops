import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

vi.mock("node:fs");
vi.mock("node:os", () => ({
  default: { homedir: () => "/home/testuser" },
  homedir: () => "/home/testuser",
}));

import fs from "node:fs";
import {
  discoverWorkspaceConfigs,
  computeConfigHash,
  isFolderTrusted,
  trustFolder,
  untrustFolder,
  listTrustedFolders,
} from "../trust";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

/** Simulated trust store kept in memory across mock calls within a test. */
let trustStoreData: Record<string, unknown>;

function setupTrustStoreMock(): void {
  trustStoreData = {};

  // readFileSync: return trust store for trusted-folders.json
  mockReadFileSync.mockImplementation(((filePath: string) => {
    if (String(filePath).includes("trusted-folders.json")) {
      return JSON.stringify(trustStoreData);
    }
    return "";
  }) as typeof fs.readFileSync);

  // writeFileSync: intercept trust store writes
  mockWriteFileSync.mockImplementation(((filePath: string, data: string) => {
    if (String(filePath).includes("trusted-folders.json")) {
      trustStoreData = JSON.parse(data);
    }
  }) as typeof fs.writeFileSync);

  mockMkdirSync.mockImplementation((() => undefined) as unknown as typeof fs.mkdirSync);
  mockExistsSync.mockReturnValue(true);
}

describe("discoverWorkspaceConfigs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds agents, MCP servers, and skills", () => {
    mockExistsSync.mockImplementation(((p: string) => {
      const s = String(p);
      if (s.endsWith("mcp.json")) return true;
      if (s.endsWith("agents")) return true;
      if (s.endsWith("skills")) return true;
      return false;
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (String(dirPath).endsWith("agents")) return ["terraform.yaml", "k8s.yaml"];
      if (String(dirPath).endsWith("skills")) return ["docker.dops", "ci.dops"];
      return [];
    }) as typeof fs.readdirSync);

    const result = discoverWorkspaceConfigs("/project");

    expect(result.agents).toEqual(["k8s.yaml", "terraform.yaml"]);
    expect(result.mcpServers).toEqual(["mcp.json"]);
    expect(result.skills).toEqual(["ci.dops", "docker.dops"]);
  });

  it("returns empty when no configs exist", () => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockImplementation((() => {
      throw new Error("ENOENT");
    }) as typeof fs.readdirSync);

    const result = discoverWorkspaceConfigs("/empty-project");

    expect(result.agents).toEqual([]);
    expect(result.mcpServers).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  it("filters out dotfiles from directory listings", () => {
    mockExistsSync.mockImplementation(((p: string) => {
      const s = String(p);
      if (s.endsWith("agents")) return true;
      return false; // no mcp.json, no skills dir
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (String(dirPath).endsWith("agents")) return [".hidden", "visible.yaml"];
      return [];
    }) as typeof fs.readdirSync);

    const result = discoverWorkspaceConfigs("/project");

    expect(result.agents).toEqual(["visible.yaml"]);
  });
});

describe("computeConfigHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is deterministic for same inputs", () => {
    // Set up consistent filesystem mock
    mockExistsSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("agents")) return true;
      if (String(p).endsWith("mcp.json")) return false;
      if (String(p).endsWith("skills")) return false;
      return false;
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (String(dirPath).endsWith("agents")) return ["agent1.yaml"];
      return [];
    }) as typeof fs.readdirSync);

    mockReadFileSync.mockImplementation(((filePath: string) => {
      if (String(filePath).includes("agent1.yaml")) return "name: test-agent";
      return "";
    }) as typeof fs.readFileSync);

    const hash1 = computeConfigHash("/project");
    const hash2 = computeConfigHash("/project");

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it("produces different hash for different content", () => {
    let agentContent = "name: agent-v1";

    mockExistsSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("agents")) return true;
      return false;
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (String(dirPath).endsWith("agents")) return ["agent.yaml"];
      return [];
    }) as typeof fs.readdirSync);

    mockReadFileSync.mockImplementation((() => {
      return agentContent;
    }) as typeof fs.readFileSync);

    const hash1 = computeConfigHash("/project");

    agentContent = "name: agent-v2";
    const hash2 = computeConfigHash("/project");

    expect(hash1).not.toBe(hash2);
  });
});

describe("isFolderTrusted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTrustStoreMock();
  });

  it("returns trusted:true for folders with no configs", () => {
    mockExistsSync.mockReturnValue(false); // no mcp.json
    mockReaddirSync.mockImplementation((() => {
      throw new Error("ENOENT");
    }) as typeof fs.readdirSync);

    const result = isFolderTrusted("/project");

    expect(result.trusted).toBe(true);
    expect(result.hashChanged).toBe(false);
  });

  it("returns untrusted for new folders with configs", () => {
    mockExistsSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("mcp.json")) return true;
      if (String(p).includes("trusted-folders.json")) return false;
      return false;
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation((() => []) as typeof fs.readdirSync);

    // Trust store is empty (no entry for this folder)
    trustStoreData = {};

    const result = isFolderTrusted("/new-project");

    expect(result.trusted).toBe(false);
    expect(result.hashChanged).toBe(false);
    expect(result.configs.mcpServers).toEqual(["mcp.json"]);
  });
});

describe("trustFolder + isFolderTrusted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTrustStoreMock();
  });

  it("returns trusted after trusting", () => {
    // Setup: folder has an agent config
    mockExistsSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("agents")) return true;
      if (String(p).endsWith("mcp.json")) return false;
      if (String(p).endsWith("skills")) return false;
      return true;
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (String(dirPath).endsWith("agents")) return ["my-agent.yaml"];
      return [];
    }) as typeof fs.readdirSync);

    mockReadFileSync.mockImplementation(((filePath: string) => {
      if (String(filePath).includes("trusted-folders.json")) {
        return JSON.stringify(trustStoreData);
      }
      if (String(filePath).includes("my-agent.yaml")) return "name: my-agent";
      return "";
    }) as typeof fs.readFileSync);

    mockWriteFileSync.mockImplementation(((filePath: string, data: string) => {
      if (String(filePath).includes("trusted-folders.json")) {
        trustStoreData = JSON.parse(data);
      }
    }) as typeof fs.writeFileSync);

    // Initially untrusted
    const beforeTrust = isFolderTrusted("/my-project");
    expect(beforeTrust.trusted).toBe(false);

    // Trust it
    trustFolder("/my-project");

    // Now trusted
    const afterTrust = isFolderTrusted("/my-project");
    expect(afterTrust.trusted).toBe(true);
    expect(afterTrust.hashChanged).toBe(false);
  });
});

describe("untrustFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTrustStoreMock();
  });

  it("removes trust entry and returns true", () => {
    const absDir = path.resolve("/trusted-project");
    trustStoreData = {
      [absDir]: {
        contentHash: "abc123",
        trustedAt: "2024-01-01T00:00:00.000Z",
        configs: { agents: [], mcpServers: [], skills: [] },
      },
    };

    const result = untrustFolder("/trusted-project");

    expect(result).toBe(true);
    expect(trustStoreData).not.toHaveProperty(absDir);
  });

  it("returns false when folder was not trusted", () => {
    trustStoreData = {};

    const result = untrustFolder("/unknown-project");

    expect(result).toBe(false);
  });
});

describe("listTrustedFolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTrustStoreMock();
  });

  it("returns all trusted folders", () => {
    trustStoreData = {
      "/project-a": {
        contentHash: "hash-a",
        trustedAt: "2024-01-01T00:00:00.000Z",
        configs: { agents: ["a.yaml"], mcpServers: [], skills: [] },
      },
      "/project-b": {
        contentHash: "hash-b",
        trustedAt: "2024-06-01T00:00:00.000Z",
        configs: { agents: [], mcpServers: ["mcp.json"], skills: [] },
      },
    };

    const result = listTrustedFolders();

    expect(Object.keys(result)).toHaveLength(2);
    expect(result["/project-a"]).toBeDefined();
    expect(result["/project-b"]).toBeDefined();
    expect(result["/project-a"].contentHash).toBe("hash-a");
  });

  it("returns empty object when no folders trusted", () => {
    trustStoreData = {};

    const result = listTrustedFolders();

    expect(result).toEqual({});
  });
});

describe("hash change detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTrustStoreMock();
  });

  it("detects when config content has changed since trust was granted", () => {
    const absDir = path.resolve("/project");

    // Trust store has an old hash
    trustStoreData = {
      [absDir]: {
        contentHash: "old-hash-that-wont-match",
        trustedAt: "2024-01-01T00:00:00.000Z",
        configs: { agents: ["agent.yaml"], mcpServers: [], skills: [] },
      },
    };

    // Folder has agent configs (so it's not "no configs" path)
    mockExistsSync.mockImplementation(((p: string) => {
      if (String(p).endsWith("agents")) return true;
      if (String(p).endsWith("mcp.json")) return false;
      if (String(p).endsWith("skills")) return false;
      return true;
    }) as typeof fs.existsSync);

    mockReaddirSync.mockImplementation(((dirPath: string) => {
      if (String(dirPath).endsWith("agents")) return ["agent.yaml"];
      return [];
    }) as typeof fs.readdirSync);

    mockReadFileSync.mockImplementation(((filePath: string) => {
      if (String(filePath).includes("trusted-folders.json")) {
        return JSON.stringify(trustStoreData);
      }
      if (String(filePath).includes("agent.yaml")) return "name: changed-agent";
      return "";
    }) as typeof fs.readFileSync);

    const result = isFolderTrusted("/project");

    expect(result.trusted).toBe(false);
    expect(result.hashChanged).toBe(true);
  });
});
