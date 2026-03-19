import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExitCode, CLIError } from "../exit-codes";
import { CLIContext } from "../types";

const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
}));

vi.mock("node:fs", () => ({
  default: {
    writeFileSync: vi.fn(),
  },
  writeFileSync: vi.fn(),
}));

vi.mock("../state", () => ({
  findProjectRoot: vi.fn(),
  readAudit: vi.fn(),
}));

import { auditExportCommand } from "../commands/audit-export";
import { findProjectRoot, readAudit } from "../state";
import fs from "node:fs";

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
      dryRun: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

const sampleEntry = {
  timestamp: "2026-01-15T10:00:00.000Z",
  user: "testuser",
  command: "plan",
  action: "generate",
  status: "success" as const,
  durationMs: 1234,
  seq: 1,
  hash: "abc123",
};

describe("auditExportCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof auditExportCommand).toBe("function");
  });

  it("logs info when no .dojops/ project is found", async () => {
    vi.mocked(findProjectRoot).mockReturnValue(null);

    await auditExportCommand([], makeCtx());

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("No .dojops/ project"));
  });

  it("logs info when no audit entries exist", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([]);

    await auditExportCommand([], makeCtx());

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("No audit entries"));
  });

  it("throws CLIError for invalid --format value", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([sampleEntry]);

    await expect(auditExportCommand(["--format", "xml"], makeCtx())).rejects.toThrow(CLIError);

    try {
      await auditExportCommand(["--format", "xml"], makeCtx());
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.VALIDATION_ERROR);
      expect((e as CLIError).message).toContain("xml");
    }
  });

  it("exports JSON to stdout by default", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([sampleEntry]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditExportCommand([], makeCtx());

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveLength(1);
    expect(output[0].command).toBe("plan");
    consoleSpy.mockRestore();
  });

  it("exports CSV format", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([sampleEntry]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditExportCommand(["--format", "csv"], makeCtx());

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("timestamp,sequence,type,summary,hash,status,user,durationMs");
    consoleSpy.mockRestore();
  });

  it("exports syslog format", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([sampleEntry]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditExportCommand(["--format", "syslog"], makeCtx());

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("dojops");
    expect(output).toContain("plan/generate");
    consoleSpy.mockRestore();
  });

  it("writes to file when --output is specified", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([sampleEntry]);

    await auditExportCommand(["--output", "/tmp/audit.json"], makeCtx());

    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      "/tmp/audit.json",
      expect.any(String),
      "utf-8",
    );
    expect(mockLog.success).toHaveBeenCalled();
  });

  it("throws CLIError for invalid --since date", async () => {
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([sampleEntry]);

    await expect(auditExportCommand(["--since", "not-a-date"], makeCtx())).rejects.toThrow(
      CLIError,
    );
  });

  it("filters entries by --since and --until", async () => {
    const entry1 = { ...sampleEntry, timestamp: "2026-01-10T00:00:00.000Z" };
    const entry2 = { ...sampleEntry, timestamp: "2026-01-20T00:00:00.000Z" };
    vi.mocked(findProjectRoot).mockReturnValue("/project");
    vi.mocked(readAudit).mockReturnValue([entry1, entry2]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await auditExportCommand(["--since", "2026-01-15T00:00:00Z"], makeCtx());

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toHaveLength(1);
    expect(output[0].timestamp).toBe("2026-01-20T00:00:00.000Z");
    consoleSpy.mockRestore();
  });
});
