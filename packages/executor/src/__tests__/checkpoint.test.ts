import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "abcd1234-0000-0000-0000-000000000000"),
}));

import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createCheckpoint,
  restoreCheckpoint,
  listCheckpoints,
  cleanCheckpoints,
  checkpointsDir,
  type CheckpointEntry,
} from "../checkpoint";

const mockExecFileSync = vi.mocked(execFileSync);
const mockFs = vi.mocked(fs);

describe("checkpointsDir", () => {
  it("returns .dojops/checkpoints under root", () => {
    expect(checkpointsDir("/project")).toBe("/project/.dojops/checkpoints");
  });
});

describe("createCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no git changes exist", () => {
    mockExecFileSync.mockReturnValueOnce("" as never); // git stash create returns empty

    const result = createCheckpoint("/project");

    expect(result).toBeNull();
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it("creates checkpoint entry with correct fields when changes exist", () => {
    mockExecFileSync
      .mockReturnValueOnce("abc123def\n" as never) // git stash create
      .mockReturnValueOnce("src/index.ts\nsrc/main.ts\n" as never); // git diff --name-only

    const result = createCheckpoint("/project", "before-refactor");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("abcd1234"); // first 8 chars of mocked UUID
    expect(result!.name).toBe("before-refactor");
    expect(result!.stashRef).toBe("abc123def");
    expect(result!.filesTracked).toEqual(["src/index.ts", "src/main.ts"]);
    expect(result!.timestamp).toBeTruthy();
    expect(mockFs.mkdirSync).toHaveBeenCalledWith("/project/.dojops/checkpoints", {
      recursive: true,
    });
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      "/project/.dojops/checkpoints/abcd1234.json",
      expect.stringContaining('"stashRef": "abc123def"'),
    );
  });

  it("creates checkpoint with empty filesTracked when diff is empty", () => {
    mockExecFileSync
      .mockReturnValueOnce("abc123\n" as never) // git stash create
      .mockReturnValueOnce("" as never); // git diff --name-only (empty)

    const result = createCheckpoint("/project");

    expect(result).not.toBeNull();
    expect(result!.filesTracked).toEqual([]);
    expect(result!.name).toBeUndefined();
  });
});

describe("listCheckpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no checkpoints dir exists", () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = listCheckpoints("/project");

    expect(result).toEqual([]);
  });

  it("returns sorted (newest first) list of checkpoints", () => {
    const older: CheckpointEntry = {
      id: "aaaa1111",
      stashRef: "ref1",
      timestamp: "2024-01-01T00:00:00.000Z",
      filesTracked: ["a.ts"],
    };
    const newer: CheckpointEntry = {
      id: "bbbb2222",
      name: "latest",
      stashRef: "ref2",
      timestamp: "2024-06-15T12:00:00.000Z",
      filesTracked: ["b.ts"],
    };

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["aaaa1111.json", "bbbb2222.json"] as never);
    mockFs.readFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.includes("aaaa1111")) return JSON.stringify(older);
      if (p.includes("bbbb2222")) return JSON.stringify(newer);
      throw new Error("unexpected read");
    });

    const result = listCheckpoints("/project");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("bbbb2222"); // newer first
    expect(result[1].id).toBe("aaaa1111");
  });

  it("skips non-json files", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["checkpoint.json", "readme.txt"] as never);
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        id: "cccc3333",
        stashRef: "ref3",
        timestamp: "2024-03-01T00:00:00.000Z",
        filesTracked: [],
      }),
    );

    const result = listCheckpoints("/project");

    expect(result).toHaveLength(1);
  });

  it("skips files with invalid JSON", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["good.json", "bad.json"] as never);
    mockFs.readFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.includes("bad")) return "not valid json";
      return JSON.stringify({
        id: "good1111",
        stashRef: "ref",
        timestamp: "2024-01-01T00:00:00.000Z",
        filesTracked: [],
      });
    });

    const result = listCheckpoints("/project");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("good1111");
  });
});

describe("cleanCheckpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no checkpoints dir exists", () => {
    mockFs.existsSync.mockReturnValue(false);

    expect(cleanCheckpoints("/project")).toBe(0);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it("removes all checkpoint files and returns count", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["a.json", "b.json", "c.json"] as never);

    const count = cleanCheckpoints("/project");

    expect(count).toBe(3);
    expect(mockFs.unlinkSync).toHaveBeenCalledTimes(3);
    expect(mockFs.unlinkSync).toHaveBeenCalledWith("/project/.dojops/checkpoints/a.json");
  });

  it("only removes .json files", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["a.json", "readme.md"] as never);

    const count = cleanCheckpoints("/project");

    expect(count).toBe(1);
    expect(mockFs.unlinkSync).toHaveBeenCalledTimes(1);
  });
});

describe("restoreCheckpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores checkpoint by id", () => {
    const entry: CheckpointEntry = {
      id: "aaaa1111",
      stashRef: "ref-abc",
      timestamp: "2024-01-01T00:00:00.000Z",
      filesTracked: ["file.ts"],
    };

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["aaaa1111.json"] as never);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(entry));

    const result = restoreCheckpoint("/project", "aaaa1111");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("aaaa1111");
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["stash", "apply", "ref-abc"], {
      cwd: "/project",
    });
  });

  it("returns null for unknown id", () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([] as never);

    const result = restoreCheckpoint("/project", "nonexistent");

    expect(result).toBeNull();
    // git stash apply should never be called
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("returns null for unknown name", () => {
    const entry: CheckpointEntry = {
      id: "aaaa1111",
      name: "known-name",
      stashRef: "ref",
      timestamp: "2024-01-01T00:00:00.000Z",
      filesTracked: [],
    };

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["aaaa1111.json"] as never);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(entry));

    const result = restoreCheckpoint("/project", "unknown-name");

    expect(result).toBeNull();
  });
});

describe("findCheckpoint (via restoreCheckpoint)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("matches by name", () => {
    const entry: CheckpointEntry = {
      id: "aaaa1111",
      name: "pre-deploy",
      stashRef: "ref-xyz",
      timestamp: "2024-01-01T00:00:00.000Z",
      filesTracked: ["deploy.ts"],
    };

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(["aaaa1111.json"] as never);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(entry));

    const result = restoreCheckpoint("/project", "pre-deploy");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("aaaa1111");
    expect(result!.name).toBe("pre-deploy");
    expect(mockExecFileSync).toHaveBeenCalledWith("git", ["stash", "apply", "ref-xyz"], {
      cwd: "/project",
    });
  });
});
