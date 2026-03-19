import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExitCode, CLIError } from "../exit-codes";
import { CLIContext } from "../types";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

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
  note: vi.fn(),
}));

vi.mock("../state", () => ({
  findProjectRoot: vi.fn(() => null),
  appendAudit: vi.fn(),
  getCurrentUser: vi.fn(() => "testuser"),
}));

import { costCommand } from "../commands/cost";
import { execFileSync } from "node:child_process";

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

describe("costCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof costCommand).toBe("function");
  });

  it("throws CLIError when infracost is not installed", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("command not found");
    });

    await expect(costCommand([], makeCtx())).rejects.toThrow(CLIError);

    try {
      await costCommand([], makeCtx());
    } catch (e) {
      expect((e as CLIError).exitCode).toBe(ExitCode.GENERAL_ERROR);
      expect((e as CLIError).message).toContain("Infracost is not installed");
    }
  });

  it("runs infracost and displays summary for table output", async () => {
    const mockOutput = JSON.stringify({
      version: "0.2",
      currency: "USD",
      projects: [
        {
          name: "test",
          path: ".",
          currency: "USD",
          totalMonthlyCost: "42.50",
          totalHourlyCost: "0.058",
          resources: [{ name: "aws_instance.web", monthlyCost: "42.50" }],
        },
      ],
      totalMonthlyCost: "42.50",
      totalHourlyCost: "0.058",
      timeGenerated: "2026-01-01T00:00:00Z",
    });

    // First call: --version check (succeeds)
    // Second call: breakdown (returns JSON)
    vi.mocked(execFileSync)
      .mockReturnValueOnce(Buffer.from("0.10.0"))
      .mockReturnValueOnce(Buffer.from(mockOutput));

    await costCommand([], makeCtx());

    expect(mockSpinner.start).toHaveBeenCalled();
    expect(mockSpinner.stop).toHaveBeenCalledWith("Cost estimation complete");
  });

  it("outputs JSON when --output=json", async () => {
    const mockData = {
      version: "0.2",
      currency: "USD",
      projects: [],
      totalMonthlyCost: "0",
      totalHourlyCost: "0",
      timeGenerated: "2026-01-01T00:00:00Z",
    };

    vi.mocked(execFileSync)
      .mockReturnValueOnce(Buffer.from("0.10.0"))
      .mockReturnValueOnce(Buffer.from(JSON.stringify(mockData)));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await costCommand([], makeCtx({ output: "json" }));

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.currency).toBe("USD");
    consoleSpy.mockRestore();
  });

  it("uses the first positional arg as target path", async () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce(Buffer.from("0.10.0"))
      .mockReturnValueOnce(
        Buffer.from(
          JSON.stringify({
            version: "0.2",
            currency: "USD",
            projects: [],
            totalMonthlyCost: "0",
            totalHourlyCost: "0",
            timeGenerated: "2026-01-01T00:00:00Z",
          }),
        ),
      );

    await costCommand(["./infra"], makeCtx());

    // The second call to execFileSync (infracost breakdown) should include the path
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls[1][0]).toBe("infracost");
    expect(calls[1][1]).toContain("--path");
  });
});
