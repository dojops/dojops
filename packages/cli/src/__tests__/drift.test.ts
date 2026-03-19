import { describe, it, expect, vi, beforeEach } from "vitest";
import { CLIError } from "../exit-codes";
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

import { driftCommand } from "../commands/drift";
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

describe("driftCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is exported as a function", () => {
    expect(typeof driftCommand).toBe("function");
  });

  it("reports no drift when terraform plan exits 0", async () => {
    vi.mocked(execFileSync).mockImplementation(((cmd: string) => {
      if (cmd === "terraform") {
        return Buffer.from("");
      }
      if (cmd === "kubectl") {
        return Buffer.from("");
      }
      return Buffer.from("");
    }) as typeof execFileSync);

    await driftCommand(["--terraform"], makeCtx());

    expect(mockSpinner.stop).toHaveBeenCalledWith("No Terraform drift");
  });

  it("detects terraform drift when plan exits with code 2", async () => {
    const planJson = JSON.stringify({
      resource_changes: [
        {
          address: "aws_instance.web",
          type: "aws_instance",
          change: { actions: ["update"] },
        },
      ],
    });

    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error("exit 2") as Error & { status: number; stdout: Buffer };
      err.status = 2;
      err.stdout = Buffer.from(planJson);
      throw err;
    });

    await driftCommand(["--terraform"], makeCtx());

    expect(mockSpinner.stop).toHaveBeenCalledWith("Terraform drift detected");
  });

  it("throws CLIError when terraform command fails", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error("terraform error") as Error & {
        status: number;
        stdout: Buffer;
        stderr: Buffer;
      };
      err.status = 1;
      err.stdout = Buffer.from("");
      err.stderr = Buffer.from("state not initialized");
      throw err;
    });

    await expect(driftCommand(["--terraform"], makeCtx())).rejects.toThrow(CLIError);
  });

  it("detects kubernetes drift when kubectl diff exits 1", async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error("exit 1") as Error & { status: number; stdout: Buffer; stderr: Buffer };
      err.status = 1;
      err.stdout = Buffer.from("diff -u /Deployment/nginx\n-replicas: 2\n+replicas: 3\n");
      err.stderr = Buffer.from("");
      throw err;
    });

    await driftCommand(["--kubernetes"], makeCtx());

    expect(mockSpinner.stop).toHaveBeenCalledWith("Kubernetes drift detected");
  });

  it("logs info when neither terraform nor kubernetes is found in auto-detect mode", async () => {
    // Both terraform and kubectl fail with non-drift errors
    vi.mocked(execFileSync).mockImplementation(() => {
      const err = new Error("not found") as Error & {
        status: number;
        stdout: Buffer;
        stderr: Buffer;
      };
      err.status = 127;
      err.stdout = Buffer.from("");
      err.stderr = Buffer.from("command not found");
      throw err;
    });

    await driftCommand([], makeCtx());

    expect(mockLog.warn).toHaveBeenCalled();
  });

  it("outputs JSON when --output=json", async () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await driftCommand(["--terraform"], makeCtx({ output: "json" }));

    expect(consoleSpy).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.source).toBe("terraform");
    expect(output.driftDetected).toBe(false);
    consoleSpy.mockRestore();
  });
});
