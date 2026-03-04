import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock fs to avoid real filesystem operations
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    mkdirSync: vi.fn(),
  };
});

import { extractTarXz, extractTarGz, extractZip } from "../toolchain-sandbox";

describe("toolchain-sandbox", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  describe("extractTarXz", () => {
    it("calls tar with xJf flag for xz decompression", () => {
      extractTarXz("/tmp/archive.tar.xz", "/tmp/dest");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "tar",
        ["xJf", "/tmp/archive.tar.xz", "-C", "/tmp/dest"],
        expect.objectContaining({ timeout: 60_000 }),
      );
    });

    it("uses different flag than extractTarGz", () => {
      extractTarXz("/tmp/archive.tar.xz", "/tmp/dest");
      const xzArgs = mockExecFileSync.mock.calls[0][1];

      mockExecFileSync.mockReset();
      extractTarGz("/tmp/archive.tar.gz", "/tmp/dest");
      const gzArgs = mockExecFileSync.mock.calls[0][1];

      // xz uses 'xJf', gz uses 'xzf'
      expect(xzArgs[0]).toBe("xJf");
      expect(gzArgs[0]).toBe("xzf");
    });
  });

  describe("extractZip", () => {
    it("calls unzip with correct arguments", () => {
      extractZip("/tmp/archive.zip", "/tmp/dest");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "unzip",
        ["-o", "/tmp/archive.zip", "-d", "/tmp/dest"],
        expect.objectContaining({ timeout: 60_000 }),
      );
    });
  });
});
