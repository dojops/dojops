import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockRenameSync = vi.mocked(fs.renameSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);

// Import AFTER vi.mock so the module picks up the mocked fs
import { atomicWriteFileSync } from "../file-reader";

describe("atomicWriteFileSync rename failure cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdirSync.mockReturnValue(undefined);
    mockWriteFileSync.mockReturnValue(undefined);
  });

  it("cleans up temp file when renameSync throws", () => {
    const renameError = new Error("EXDEV: cross-device link not permitted");
    mockRenameSync.mockImplementation(() => {
      throw renameError;
    });

    expect(() => atomicWriteFileSync("/some/dir/file.yml", "content")).toThrow(renameError);

    // unlinkSync should have been called with the .tmp file path
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    const tmpPath = mockUnlinkSync.mock.calls[0][0] as string;
    expect(tmpPath).toMatch(/^\/some\/dir\/file\.yml\.[a-f0-9]+\.tmp$/);
  });

  it("re-throws the original error after temp file cleanup", () => {
    const renameError = new Error("rename failed: permission denied");
    mockRenameSync.mockImplementation(() => {
      throw renameError;
    });

    expect(() => atomicWriteFileSync("/dir/f.yml", "data")).toThrow(
      "rename failed: permission denied",
    );

    // Verify cleanup was attempted
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
  });

  it("still re-throws original error even when temp file cleanup also fails", () => {
    const renameError = new Error("rename failed");
    mockRenameSync.mockImplementation(() => {
      throw renameError;
    });
    mockUnlinkSync.mockImplementation(() => {
      throw new Error("unlink also failed");
    });

    // The original rename error should be thrown, not the unlink error
    expect(() => atomicWriteFileSync("/dir/f.yml", "data")).toThrow("rename failed");

    // Verify cleanup was still attempted
    expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
  });

  it("temp file path matches the pattern used by writeFileSync", () => {
    const renameError = new Error("rename failed");
    mockRenameSync.mockImplementation(() => {
      throw renameError;
    });

    expect(() => atomicWriteFileSync("/target/config.yml", "content")).toThrow();

    // The same .tmp path written by writeFileSync should be the one cleaned up
    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    const cleanedPath = mockUnlinkSync.mock.calls[0][0] as string;
    expect(writtenPath).toBe(cleanedPath);
    expect(writtenPath).toContain(".tmp");
  });
});
