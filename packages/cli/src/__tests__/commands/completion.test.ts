import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  completionBashCommand,
  completionZshCommand,
  completionFishCommand,
  completionUsageCommand,
} from "../../commands/completion";
import { CLIContext, DEFAULT_GLOBAL_OPTIONS } from "../../types";

function makeMockCtx(): CLIContext {
  return {
    globalOpts: { ...DEFAULT_GLOBAL_OPTIONS },
    config: {} as CLIContext["config"],
    cwd: "/tmp/test",
    getProvider: () => {
      throw new Error("no provider");
    },
  };
}

describe("completion command", () => {
  let consoleOutput: string[];

  beforeEach(() => {
    consoleOutput = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bash outputs script with _dojops function", async () => {
    await completionBashCommand([], makeMockCtx());
    const output = consoleOutput.join("\n");
    expect(output).toContain("_dojops");
    expect(output).toContain("complete -F _dojops dojops");
  });

  it("zsh outputs script with compdef", async () => {
    await completionZshCommand([], makeMockCtx());
    const output = consoleOutput.join("\n");
    expect(output).toContain("compdef _dojops dojops");
  });

  it("fish outputs script with complete -c dojops", async () => {
    await completionFishCommand([], makeMockCtx());
    const output = consoleOutput.join("\n");
    expect(output).toContain("complete -c dojops");
  });

  it("usage command prints usage to stderr and exits 2", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`exit:${code}`);
    });

    await expect(completionUsageCommand([], makeMockCtx())).rejects.toThrow("exit:2");
    expect(stderrSpy).toHaveBeenCalled();
    const errOutput = stderrSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOutput).toContain("completion");

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});
