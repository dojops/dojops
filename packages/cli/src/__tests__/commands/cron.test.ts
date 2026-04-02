import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CLIContext } from "../../types";

// Mock child_process
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

// Mock @clack/prompts
const { mockLog, mockNote } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  mockNote: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: mockNote,
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

// Mock state
let mockProjectRoot: string | null = null;
vi.mock("../../state", () => ({
  findProjectRoot: () => mockProjectRoot,
}));

function makeCtx(outputFormat?: string): CLIContext {
  return {
    cwd: "/tmp",
    config: { tokens: {} },
    globalOpts: {
      output: outputFormat ?? "text",
      provider: undefined,
      model: undefined,
      nonInteractive: false,
    },
    lazyProvider: () => {
      throw new Error("No provider");
    },
  } as unknown as CLIContext;
}

describe("cron command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-cron-test-"));
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    mockProjectRoot = tmpDir;
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mockProjectRoot = null;
  });

  async function runCron(args: string[], ctx?: CLIContext) {
    const { cronCommand } = await import("../../commands/cron");
    return cronCommand(args, ctx ?? makeCtx());
  }

  function readCronConfig() {
    const configPath = path.join(tmpDir, ".dojops", "cron.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  describe("add", () => {
    it("adds a job with schedule and command", async () => {
      await runCron(["add", "0 2 * * *", "scan", "--security"]);
      const config = readCronConfig();
      expect(config.jobs).toHaveLength(1);
      expect(config.jobs[0].schedule).toBe("0 2 * * *");
      expect(config.jobs[0].command).toBe("scan --security");
      expect(config.jobs[0].enabled).toBe(true);
    });

    it("rejects invalid cron schedule", async () => {
      await expect(runCron(["add", "invalid", "scan"])).rejects.toThrow("5 fields");
    });

    it("rejects missing arguments", async () => {
      await expect(runCron(["add"])).rejects.toThrow("Schedule and command required");
    });
  });

  describe("list", () => {
    it("shows empty message when no jobs", async () => {
      await runCron(["list"]);
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("No scheduled jobs"));
    });

    it("outputs JSON when requested", async () => {
      await runCron(["add", "0 2 * * *", "scan"]);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCron(["list"], makeCtx("json"));
      expect(logSpy).toHaveBeenCalled();
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output).toHaveLength(1);
      expect(output[0].schedule).toBe("0 2 * * *");
      logSpy.mockRestore();
    });
  });

  describe("remove", () => {
    it("removes a job by ID", async () => {
      await runCron(["add", "0 2 * * *", "scan"]);
      const config = readCronConfig();
      const jobId = config.jobs[0].id;
      await runCron(["remove", jobId]);
      const updated = readCronConfig();
      expect(updated.jobs).toHaveLength(0);
    });

    it("rejects unknown job ID", async () => {
      await expect(runCron(["remove", "nonexistent"])).rejects.toThrow("not found");
    });
  });

  describe("enable/disable", () => {
    it("disables a job", async () => {
      await runCron(["add", "0 2 * * *", "scan"]);
      const config = readCronConfig();
      const jobId = config.jobs[0].id;
      await runCron(["disable", jobId]);
      const updated = readCronConfig();
      expect(updated.jobs[0].enabled).toBe(false);
    });

    it("re-enables a disabled job", async () => {
      await runCron(["add", "0 2 * * *", "scan"]);
      const config = readCronConfig();
      const jobId = config.jobs[0].id;
      await runCron(["disable", jobId]);
      await runCron(["enable", jobId]);
      const updated = readCronConfig();
      expect(updated.jobs[0].enabled).toBe(true);
    });
  });

  describe("install", () => {
    it("installs enabled jobs to system crontab", async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "crontab" && args[0] === "-l") return Buffer.from("");
        return Buffer.from("");
      });
      await runCron(["add", "0 2 * * *", "scan"]);
      await runCron(["install"]);
      // crontab was called with -l to read, then with the temp file to write
      expect(mockExecFileSync).toHaveBeenCalledWith("crontab", ["-l"], expect.anything());
      const config = readCronConfig();
      expect(config.jobs[0].installedAt).toBeTruthy();
    });

    it("skips when no enabled jobs", async () => {
      await runCron(["install"]);
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("No enabled jobs"));
    });
  });

  describe("uninstall", () => {
    it("removes dojops entries from crontab", async () => {
      mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
        if (cmd === "crontab" && args[0] === "-l") {
          return Buffer.from(
            "0 * * * * /usr/bin/other-task\n0 2 * * * cd /tmp && dojops scan # dojops:job-123\n",
          );
        }
        return Buffer.from("");
      });
      await runCron(["uninstall"]);
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining("Removed 1"));
    });

    it("reports no jobs when crontab is clean", async () => {
      mockExecFileSync.mockImplementation(() => Buffer.from("0 * * * * /usr/bin/other\n"));
      await runCron(["uninstall"]);
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("No DojOps cron jobs"));
    });
  });

  describe("status", () => {
    it("shows sync status", async () => {
      mockExecFileSync.mockImplementation(() => Buffer.from(""));
      await runCron(["add", "0 2 * * *", "scan"]);
      await runCron(["status"]);
      expect(mockNote).toHaveBeenCalled();
    });

    it("outputs JSON", async () => {
      mockExecFileSync.mockImplementation(() => Buffer.from(""));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCron(["status"], makeCtx("json"));
      const output = JSON.parse(logSpy.mock.calls[0][0]);
      expect(output).toHaveProperty("totalJobs");
      expect(output).toHaveProperty("enabledJobs");
      expect(output).toHaveProperty("installedInCrontab");
      logSpy.mockRestore();
    });
  });

  describe("help", () => {
    it("shows help when no subcommand given", async () => {
      await runCron([]);
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("SUBCOMMANDS"));
    });

    it("rejects unknown subcommand", async () => {
      await expect(runCron(["bogus"])).rejects.toThrow("Unknown subcommand");
    });
  });
});
