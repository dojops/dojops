import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import path from "node:path";

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    copyFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import fs from "node:fs";
import {
  isOfflineMode,
  skillCacheDir,
  ensureSkillCache,
  findCachedSkill,
  listCachedSkills,
  exportSkillBundle,
  importSkillBundle,
} from "../offline";

describe("isOfflineMode", () => {
  const originalEnv = process.env.DOJOPS_OFFLINE;
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.DOJOPS_OFFLINE;
    process.argv = [...originalArgv];
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.DOJOPS_OFFLINE = originalEnv;
    }
    process.argv = originalArgv;
  });

  it("is exported as a function", () => {
    expect(typeof isOfflineMode).toBe("function");
  });

  it("returns false by default", () => {
    expect(isOfflineMode()).toBe(false);
  });

  it('returns true when DOJOPS_OFFLINE is "true"', () => {
    process.env.DOJOPS_OFFLINE = "true";
    expect(isOfflineMode()).toBe(true);
  });

  it('returns true when DOJOPS_OFFLINE is "1"', () => {
    process.env.DOJOPS_OFFLINE = "1";
    expect(isOfflineMode()).toBe(true);
  });

  it("returns true when --offline is in process.argv", () => {
    process.argv.push("--offline");
    expect(isOfflineMode()).toBe(true);
  });

  it('returns false when DOJOPS_OFFLINE is "false"', () => {
    process.env.DOJOPS_OFFLINE = "false";
    expect(isOfflineMode()).toBe(false);
  });
});

describe("skillCacheDir", () => {
  it("returns the correct cache directory path", () => {
    const result = skillCacheDir("/my/project");
    expect(result).toBe(path.join("/my/project", ".dojops", "skill-cache"));
  });
});

describe("ensureSkillCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof ensureSkillCache).toBe("function");
  });

  it("creates the cache directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);

    ensureSkillCache("/project");

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("skill-cache"), {
      recursive: true,
    });
  });

  it("copies .dops files from source directories to cache", () => {
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
      const s = String(p);
      // Cache dir exists
      if (s.includes("skill-cache") && !s.endsWith(".dops")) return true;
      // Source skills dir exists
      if (s.includes(".dojops/skills") && !s.includes("skill-cache")) return true;
      // Cached file does NOT exist yet (so copy will happen)
      if (s.endsWith(".dops")) return false;
      return false;
    }) as typeof fs.existsSync);

    vi.mocked(fs.readdirSync).mockImplementation(((dirPath: string) => {
      const s = String(dirPath);
      if (s.includes("skills") && !s.includes("skill-cache")) {
        return ["my-skill.dops", "readme.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    }) as typeof fs.readdirSync);

    ensureSkillCache("/project");

    expect(fs.copyFileSync).toHaveBeenCalled();
  });
});

describe("findCachedSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file path when cached skill exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = findCachedSkill("/project", "terraform");
    expect(result).toBe(path.join("/project", ".dojops", "skill-cache", "terraform.dops"));
  });

  it("returns null when cached skill does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = findCachedSkill("/project", "terraform");
    expect(result).toBeNull();
  });
});

describe("listCachedSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when cache directory does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = listCachedSkills("/project");
    expect(result).toEqual([]);
  });

  it("returns only .dops files with name, path, and size", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "terraform.dops",
      "k8s.dops",
      "readme.md",
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as fs.Stats);

    const result = listCachedSkills("/project");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "terraform",
      path: path.join("/project", ".dojops", "skill-cache", "terraform.dops"),
      sizeBytes: 2048,
    });
    expect(result[1]).toEqual({
      name: "k8s",
      path: path.join("/project", ".dojops", "skill-cache", "k8s.dops"),
      sizeBytes: 2048,
    });
  });

  it("returns empty array when cache has no .dops files", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "manifest.json",
      "readme.md",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = listCachedSkills("/project");
    expect(result).toEqual([]);
  });
});

describe("exportSkillBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the export directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

    exportSkillBundle("/tmp/export", "/project");

    expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/export", { recursive: true });
  });

  it("copies .dops files and writes manifest.json", () => {
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
      const s = String(p);
      if (s === "/tmp/export") return true;
      if (s.includes(".dojops/skills")) return true;
      return false;
    }) as typeof fs.existsSync);

    vi.mocked(fs.readdirSync).mockImplementation(((dirPath: string) => {
      if (String(dirPath).includes("skills")) {
        return ["terraform.dops", "k8s.dops"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    }) as typeof fs.readdirSync);

    const result = exportSkillBundle("/tmp/export", "/project");

    expect(fs.copyFileSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("manifest.json"),
      expect.any(String),
      "utf-8",
    );
    expect(result.count).toBeGreaterThan(0);
  });
});

describe("importSkillBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when import path does not exist", () => {
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
      // destDir exists, importPath does not
      return String(p).includes(".dojops");
    }) as typeof fs.existsSync);

    expect(() => importSkillBundle("/nonexistent")).toThrow("Import path not found");
  });

  it("copies .dops files from import path to global skills dir", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([
      "terraform.dops",
      "k8s.dops",
      "manifest.json",
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const result = importSkillBundle("/tmp/import");

    expect(fs.copyFileSync).toHaveBeenCalledTimes(2); // Only .dops files
    expect(result.count).toBe(2);
  });

  it("creates the destination directory if it does not exist", () => {
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => {
      if (String(p).includes(".dojops/skills")) return false;
      return true; // importPath exists
    }) as typeof fs.existsSync);
    vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

    importSkillBundle("/tmp/import");

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".dojops/skills"), {
      recursive: true,
    });
  });
});
