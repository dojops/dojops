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

import {
  extractTarXz,
  extractTarGz,
  extractZip,
  globalToolchainCtx,
  projectToolchainCtx,
} from "../toolchain-sandbox";

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

    it("checks for xz availability before extraction", () => {
      extractTarXz("/tmp/archive.tar.xz", "/tmp/dest");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "which",
        ["xz"],
        expect.objectContaining({ timeout: 5_000 }),
      );
    });

    it("throws helpful error when xz is not available", () => {
      mockExecFileSync.mockImplementation((bin: string) => {
        if (bin === "which") throw new Error("not found");
        return Buffer.from("");
      });
      expect(() => extractTarXz("/tmp/archive.tar.xz", "/tmp/dest")).toThrow(
        /xz is required.*not found on PATH/,
      );
    });

    it("uses different flag than extractTarGz", () => {
      extractTarXz("/tmp/archive.tar.xz", "/tmp/dest");
      // Find the tar call (skip the `which xz` check)
      const tarCall = mockExecFileSync.mock.calls.find((c: unknown[]) => c[0] === "tar");
      const xzArgs = tarCall![1] as string[];

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

  describe("ToolchainContext", () => {
    it("globalToolchainCtx returns paths under ~/.dojops/toolchain", () => {
      const ctx = globalToolchainCtx();
      expect(ctx.dir).toContain(".dojops");
      expect(ctx.dir).toContain("toolchain");
      expect(ctx.binDir).toBe(`${ctx.dir}/bin`);
      expect(ctx.registryFile).toBe(`${ctx.dir}/registry.json`);
      expect(ctx.nodeModules).toBe(`${ctx.dir}/node_modules`);
      expect(ctx.npmBin).toBe(`${ctx.dir}/node_modules/.bin`);
    });

    it("projectToolchainCtx returns paths under project/.dojops/toolchain", () => {
      const ctx = projectToolchainCtx("/tmp/my-project");
      expect(ctx.dir).toBe("/tmp/my-project/.dojops/toolchain");
      expect(ctx.binDir).toBe("/tmp/my-project/.dojops/toolchain/bin");
      expect(ctx.registryFile).toBe("/tmp/my-project/.dojops/toolchain/registry.json");
      expect(ctx.nodeModules).toBe("/tmp/my-project/.dojops/toolchain/node_modules");
      expect(ctx.npmBin).toBe("/tmp/my-project/.dojops/toolchain/node_modules/.bin");
    });

    it("global and project contexts have different dirs", () => {
      const global = globalToolchainCtx();
      const project = projectToolchainCtx("/tmp/my-project");
      expect(global.dir).not.toBe(project.dir);
      expect(global.binDir).not.toBe(project.binDir);
    });
  });
});
