import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    lstatSync: vi.fn(),
    renameSync: vi.fn(),
    copyFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readdirSync: vi.fn(),
  };
});

const mockExistsSync = vi.mocked(fs.existsSync);
const mockLstatSync = vi.mocked(fs.lstatSync);
const mockRenameSync = vi.mocked(fs.renameSync);
const mockCopyFileSync = vi.mocked(fs.copyFileSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

// Import AFTER vi.mock so the module picks up the mocked fs
import { restoreBackup, backupFile } from "../file-reader";

describe("restoreBackup EXDEV fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to copyFileSync + unlinkSync on EXDEV error", () => {
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
    } as fs.Stats);

    const exdevErr = new Error("EXDEV: cross-device link not permitted") as NodeJS.ErrnoException;
    exdevErr.code = "EXDEV";
    mockRenameSync.mockImplementation(() => {
      throw exdevErr;
    });

    const result = restoreBackup("/target/config.yml");
    expect(result).toBe(true);

    // renameSync was attempted first
    expect(mockRenameSync).toHaveBeenCalledWith("/target/config.yml.bak", "/target/config.yml");
    // Fallback: copy then unlink
    expect(mockCopyFileSync).toHaveBeenCalledWith("/target/config.yml.bak", "/target/config.yml");
    expect(mockUnlinkSync).toHaveBeenCalledWith("/target/config.yml.bak");
  });

  it("re-throws non-EXDEV rename errors", () => {
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
    } as fs.Stats);

    const eaccesErr = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
    eaccesErr.code = "EACCES";
    mockRenameSync.mockImplementation(() => {
      throw eaccesErr;
    });

    expect(() => restoreBackup("/target/config.yml")).toThrow("EACCES: permission denied");
    // copyFileSync should NOT be called for non-EXDEV errors
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it("returns false when existsSync returns false for .bak path", () => {
    mockExistsSync.mockReturnValue(false);

    const result = restoreBackup("/target/config.yml");
    expect(result).toBe(false);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it("throws when backup is a symlink", () => {
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => true,
    } as fs.Stats);

    expect(() => restoreBackup("/target/config.yml")).toThrow(
      /Refusing to restore symlinked backup/,
    );
  });

  it("returns false when lstatSync throws ENOENT", () => {
    mockExistsSync.mockReturnValue(true);
    const enoentErr = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    enoentErr.code = "ENOENT";
    mockLstatSync.mockImplementation(() => {
      throw enoentErr;
    });

    const result = restoreBackup("/target/config.yml");
    expect(result).toBe(false);
  });

  it("re-throws non-ENOENT lstatSync errors", () => {
    mockExistsSync.mockReturnValue(true);
    const epermErr = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
    epermErr.code = "EPERM";
    mockLstatSync.mockImplementation(() => {
      throw epermErr;
    });

    expect(() => restoreBackup("/target/config.yml")).toThrow("EPERM: operation not permitted");
  });

  it("restores from versioned backup at given level", () => {
    // listBackups is called internally — mock readdirSync for it
    mockReaddirSync.mockReturnValue([
      "config.yml.bak.3000",
      "config.yml.bak.1000",
      "config.yml.bak.2000",
    ] as unknown as fs.Dirent[]);
    mockExistsSync.mockReturnValue(true);
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
    } as fs.Stats);
    mockRenameSync.mockReturnValue(undefined);

    // level 0 = newest (3000 after sort)
    const result = restoreBackup("/dir/config.yml", 0);
    expect(result).toBe(true);
    expect(mockRenameSync).toHaveBeenCalledWith("/dir/config.yml.bak.3000", "/dir/config.yml");
  });

  it("returns false when level exceeds available backups", () => {
    mockReaddirSync.mockReturnValue(["config.yml.bak.1000"] as unknown as fs.Dirent[]);

    const result = restoreBackup("/dir/config.yml", 5);
    expect(result).toBe(false);
    expect(mockRenameSync).not.toHaveBeenCalled();
  });
});

describe("backupFile error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when target is a symlink", () => {
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => true,
      isFile: () => false,
    } as unknown as fs.Stats);

    expect(() => backupFile("/dir/config.yml")).toThrow(/Refusing to backup symlink/);
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it("does nothing when target is not a file (e.g. directory)", () => {
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
      isFile: () => false,
    } as unknown as fs.Stats);

    backupFile("/dir/somedir");
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it("returns silently when lstatSync throws ENOENT", () => {
    const enoentErr = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    enoentErr.code = "ENOENT";
    mockLstatSync.mockImplementation(() => {
      throw enoentErr;
    });

    expect(() => backupFile("/dir/missing.yml")).not.toThrow();
    expect(mockCopyFileSync).not.toHaveBeenCalled();
  });

  it("re-throws non-ENOENT lstatSync errors", () => {
    const epermErr = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
    epermErr.code = "EPERM";
    mockLstatSync.mockImplementation(() => {
      throw epermErr;
    });

    expect(() => backupFile("/dir/config.yml")).toThrow("EPERM: operation not permitted");
  });

  it("creates timestamped backup and atomic .bak copy", () => {
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
      isFile: () => true,
    } as unknown as fs.Stats);
    mockCopyFileSync.mockReturnValue(undefined);
    mockRenameSync.mockReturnValue(undefined);

    // Mock Date.now for predictable timestamp
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    backupFile("/dir/config.yml");

    // Timestamped versioned backup
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      "/dir/config.yml",
      "/dir/config.yml.bak.1700000000000",
    );
    // Atomic .bak update: copy to tmp, then rename
    expect(mockCopyFileSync).toHaveBeenCalledWith("/dir/config.yml", "/dir/config.yml.bak.tmp");
    expect(mockRenameSync).toHaveBeenCalledWith("/dir/config.yml.bak.tmp", "/dir/config.yml.bak");

    dateSpy.mockRestore();
  });
});
