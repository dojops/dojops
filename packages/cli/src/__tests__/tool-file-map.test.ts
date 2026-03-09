import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { readExistingToolFile, TOOL_FILE_MAP } from "../tool-file-map";

vi.mock("node:fs");

const CWD = "/workspace";

describe("TOOL_FILE_MAP", () => {
  it("contains expected tool entries", () => {
    expect(TOOL_FILE_MAP).toHaveProperty("dockerfile");
    expect(TOOL_FILE_MAP).toHaveProperty("docker-compose");
    // github-actions is handled via TOOL_SCAN_DIRS (multi-file scanning)
    expect(TOOL_FILE_MAP).toHaveProperty("gitlab-ci");
    expect(TOOL_FILE_MAP).toHaveProperty("jenkinsfile");
    expect(TOOL_FILE_MAP).toHaveProperty("terraform");
    expect(TOOL_FILE_MAP).toHaveProperty("nginx");
    expect(TOOL_FILE_MAP).toHaveProperty("makefile");
    expect(TOOL_FILE_MAP).toHaveProperty("prometheus");
  });

  it("maps dockerfile to expected file names", () => {
    expect(TOOL_FILE_MAP.dockerfile).toContain("Dockerfile");
  });
});

describe("readExistingToolFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined for unknown tool name", () => {
    const result = readExistingToolFile("unknown-tool", CWD);
    expect(result).toBeUndefined();
    expect(fs.statSync).not.toHaveBeenCalled();
  });

  it("returns content and path when file exists and is within size limit", () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue("FROM node:20\n");

    const result = readExistingToolFile("dockerfile", CWD);
    expect(result).toEqual({
      content: "FROM node:20\n",
      filePath: "Dockerfile",
    });
  });

  it("tries candidates in order and returns first match", () => {
    // First candidate (Dockerfile) throws ENOENT
    vi.mocked(fs.statSync)
      .mockImplementationOnce(() => {
        throw new Error("ENOENT");
      })
      .mockReturnValueOnce({ size: 512 } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue("# Dockerfile.dev content");

    const result = readExistingToolFile("dockerfile", CWD);
    expect(result).toEqual({
      content: "# Dockerfile.dev content",
      filePath: "Dockerfile.dev",
    });
    expect(fs.statSync).toHaveBeenCalledTimes(2);
  });

  it("skips file when it exceeds 50KB size limit", () => {
    const bigSize = 51 * 1024; // Just over 50KB
    vi.mocked(fs.statSync).mockReturnValue({ size: bigSize } as fs.Stats);

    const result = readExistingToolFile("makefile", CWD);
    expect(result).toBeUndefined();
    // statSync was called but readFileSync should not have been called
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it("reads file at exactly 50KB size limit", () => {
    const exactLimit = 50 * 1024;
    vi.mocked(fs.statSync).mockReturnValue({ size: exactLimit } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue("content");

    const result = readExistingToolFile("makefile", CWD);
    expect(result).toEqual({
      content: "content",
      filePath: "Makefile",
    });
  });

  it("returns undefined when all candidates are missing", () => {
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const result = readExistingToolFile("docker-compose", CWD);
    expect(result).toBeUndefined();
    // Should have tried all 4 candidates
    expect(fs.statSync).toHaveBeenCalledTimes(4);
  });

  it("returns undefined when no github-actions files exist", () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = readExistingToolFile("github-actions", CWD);
    expect(result).toBeUndefined();
  });

  it("reads all github-actions files via directory scanning", () => {
    const makeDirent = (name: string, isDir: boolean) =>
      ({ name, isFile: () => !isDir, isDirectory: () => isDir }) as fs.Dirent;

    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const d = String(dir);
      if (d.endsWith(".github/workflows")) {
        return [
          makeDirent("ci.yml", false),
          makeDirent("reusable-build.yml", false),
        ] as unknown as fs.Dirent[];
      }
      if (d.endsWith(".github/actions")) {
        return [makeDirent("setup-node", true)] as unknown as fs.Dirent[];
      }
      if (d.endsWith("setup-node")) {
        return [makeDirent("action.yml", false)] as unknown as fs.Dirent[];
      }
      throw new Error("ENOENT");
    });
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats);
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.includes("ci.yml")) return "name: CI\n";
      if (p.includes("reusable-build")) return "name: Reusable Build\n";
      if (p.includes("action.yml")) return "name: Setup Node\n";
      return "";
    });

    const result = readExistingToolFile("github-actions", CWD);
    expect(result).toBeDefined();
    expect(result!.content).toContain("ci.yml");
    expect(result!.content).toContain("reusable-build.yml");
    expect(result!.content).toContain("action.yml");
    expect(result!.content).toContain("name: CI");
    expect(result!.content).toContain("name: Reusable Build");
    expect(result!.content).toContain("name: Setup Node");
  });

  it("skips oversized file and finds next valid candidate", () => {
    const oversized = 60 * 1024;
    vi.mocked(fs.statSync)
      .mockReturnValueOnce({ size: oversized } as fs.Stats) // first candidate too large
      .mockReturnValueOnce({ size: 2048 } as fs.Stats); // second candidate ok
    vi.mocked(fs.readFileSync).mockReturnValue("version: '3'");

    const result = readExistingToolFile("docker-compose", CWD);
    expect(result).toEqual({
      content: "version: '3'",
      filePath: "docker-compose.yaml",
    });
    expect(fs.statSync).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it("resolves absolute paths using the provided cwd", () => {
    vi.mocked(fs.statSync).mockReturnValue({ size: 100 } as fs.Stats);
    vi.mocked(fs.readFileSync).mockReturnValue("resource {}");

    readExistingToolFile("terraform", CWD);

    // Should resolve path relative to CWD
    expect(fs.statSync).toHaveBeenCalledWith(expect.stringContaining("main.tf"));
  });
});
