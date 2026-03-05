import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExitCode, CLIError } from "../../exit-codes";
import { CLIContext } from "../../types";

// Mock child_process
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

// Mock @clack/prompts
const { mockLog, mockSpinner } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockSpinner: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  spinner: vi.fn(() => mockSpinner),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

// Mock state — getDojopsVersion
vi.mock("../../state", () => ({
  getDojopsVersion: vi.fn(() => "1.0.5"),
}));

import { upgradeCommand } from "../../commands/upgrade";
import { getDojopsVersion } from "../../state";
import { execSync } from "node:child_process";
import * as clack from "@clack/prompts";

function makeCtx(overrides?: Partial<CLIContext["globalOpts"]>): CLIContext {
  return {
    globalOpts: {
      output: "table",
      raw: false,
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

// Helper to mock global fetch
function mockFetch(version: string) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ version }),
  });
}

function mockFetchError(status = 500) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  });
}

function mockFetchNetworkError() {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed"));
}

describe("upgrade command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(getDojopsVersion).mockReturnValue("1.0.5");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("already up to date", () => {
    it("shows up-to-date message when current equals latest", async () => {
      mockFetch("1.0.5");
      await upgradeCommand([], makeCtx());
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("up to date"));
    });

    it("shows up-to-date when current is ahead of latest", async () => {
      mockFetch("1.0.4");
      await upgradeCommand([], makeCtx());
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("up to date"));
    });
  });

  describe("update available", () => {
    it("shows versions and triggers install with --yes", async () => {
      mockFetch("1.1.0");
      await upgradeCommand(["--yes"], makeCtx());
      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        "npm install -g @dojops/cli@1.1.0",
        expect.objectContaining({ stdio: "inherit" }),
      );
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("1.1.0"));
    });

    it("auto-approves in non-interactive mode", async () => {
      mockFetch("2.0.0");
      await upgradeCommand([], makeCtx({ nonInteractive: true }));
      expect(vi.mocked(execSync)).toHaveBeenCalledWith(
        "npm install -g @dojops/cli@2.0.0",
        expect.objectContaining({ stdio: "inherit" }),
      );
    });

    it("prompts for confirmation interactively", async () => {
      mockFetch("1.1.0");
      vi.mocked(clack.confirm).mockResolvedValue(true);
      await upgradeCommand([], makeCtx());
      expect(clack.confirm).toHaveBeenCalled();
      expect(vi.mocked(execSync)).toHaveBeenCalled();
    });

    it("cancels when user declines", async () => {
      mockFetch("1.1.0");
      vi.mocked(clack.confirm).mockResolvedValue(false);
      await upgradeCommand([], makeCtx());
      expect(vi.mocked(execSync)).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith("Upgrade cancelled.");
    });
  });

  describe("--check mode", () => {
    it("exits with error code when update is available", async () => {
      mockFetch("1.1.0");
      await expect(upgradeCommand(["--check"], makeCtx())).rejects.toThrow(CLIError);
      try {
        await upgradeCommand(["--check"], makeCtx());
      } catch (err) {
        expect((err as CLIError).exitCode).toBe(ExitCode.GENERAL_ERROR);
      }
      expect(vi.mocked(execSync)).not.toHaveBeenCalled();
    });

    it("succeeds when already up to date", async () => {
      mockFetch("1.0.5");
      await upgradeCommand(["--check"], makeCtx());
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("up to date"));
    });
  });

  describe("network errors", () => {
    it("shows graceful error on fetch failure", async () => {
      mockFetchNetworkError();
      await expect(upgradeCommand([], makeCtx())).rejects.toThrow("Failed to check for updates");
    });

    it("shows graceful error on non-200 response", async () => {
      mockFetchError(503);
      await expect(upgradeCommand([], makeCtx())).rejects.toThrow("Failed to check for updates");
    });
  });

  describe("npm install failure", () => {
    it("shows error when install fails", async () => {
      mockFetch("1.1.0");
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("npm ERR!");
      });
      await expect(upgradeCommand(["--yes"], makeCtx())).rejects.toThrow("npm install failed");
    });
  });

  describe("JSON output", () => {
    it("outputs JSON when up to date", async () => {
      mockFetch("1.0.5");
      await upgradeCommand([], makeCtx({ output: "json" }));
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output).toEqual({
        current: "1.0.5",
        latest: "1.0.5",
        upToDate: true,
      });
    });

    it("outputs JSON when update available (--check)", async () => {
      mockFetch("2.0.0");
      await upgradeCommand(["--check"], makeCtx({ output: "json" }));
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output).toEqual({
        current: "1.0.5",
        latest: "2.0.0",
        upToDate: false,
      });
    });

    it("outputs JSON error on network failure", async () => {
      mockFetchNetworkError();
      await upgradeCommand([], makeCtx({ output: "json" }));
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.error).toContain("Failed to check for updates");
    });

    it("outputs JSON after successful upgrade", async () => {
      mockFetch("1.1.0");
      vi.mocked(execSync).mockReturnValue("");
      await upgradeCommand(["--yes"], makeCtx({ output: "json" }));
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output).toEqual({
        current: "1.0.5",
        latest: "1.1.0",
        upToDate: true,
        upgraded: true,
      });
    });
  });

  describe("unknown version", () => {
    it("errors when current version is unknown", async () => {
      vi.mocked(getDojopsVersion).mockReturnValue("unknown");
      await expect(upgradeCommand([], makeCtx())).rejects.toThrow(
        "Could not determine current version",
      );
    });

    it("outputs JSON error when current version is unknown", async () => {
      vi.mocked(getDojopsVersion).mockReturnValue("unknown");
      await upgradeCommand([], makeCtx({ output: "json" }));
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.error).toContain("Could not determine current version");
    });
  });
});
