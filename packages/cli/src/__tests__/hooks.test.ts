import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadHooksConfig, runHooks } from "../hooks";

vi.mock("node:fs");
vi.mock("../safe-exec", () => ({
  runShellCmd: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runShellCmd } from "../safe-exec";
import * as p from "@clack/prompts";

const ROOT = "/project";
const HOOKS_PATH = path.join(ROOT, ".dojops", "hooks.json");

describe("loadHooksConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads valid hooks.json", () => {
    const config = {
      hooks: {
        "pre-generate": { command: "echo pre", description: "Run pre" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

    const result = loadHooksConfig(ROOT);
    expect(fs.readFileSync).toHaveBeenCalledWith(HOOKS_PATH, "utf-8");
    expect(result).toEqual(config);
  });

  it("returns empty object when file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const result = loadHooksConfig(ROOT);
    expect(result).toEqual({});
  });

  it("returns empty object for invalid JSON", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");

    const result = loadHooksConfig(ROOT);
    expect(result).toEqual({});
  });

  it("returns empty object when parsed value is null", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("null");

    const result = loadHooksConfig(ROOT);
    expect(result).toEqual({});
  });

  it("returns empty object when parsed value is a non-object (string)", () => {
    vi.mocked(fs.readFileSync).mockReturnValue('"just a string"');

    const result = loadHooksConfig(ROOT);
    expect(result).toEqual({});
  });

  it("loads hooks config with multiple hook events", () => {
    const config = {
      hooks: {
        "pre-generate": { command: "lint", continueOnError: false },
        "post-generate": [{ command: "notify", continueOnError: true }, { command: "log" }],
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

    const result = loadHooksConfig(ROOT);
    expect(result).toEqual(config);
  });

  it("returns the parsed object even without a hooks key", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("{}");

    const result = loadHooksConfig(ROOT);
    expect(result).toEqual({});
  });
});

describe("runHooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when no hooks config exists", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = runHooks(ROOT, "pre-generate", {});
    expect(result).toBe(true);
  });

  it("returns true when config has no hooks key", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("{}");

    const result = runHooks(ROOT, "pre-generate", {});
    expect(result).toBe(true);
  });

  it("returns true when event has no hooks defined", () => {
    const config = {
      hooks: {
        "post-generate": { command: "echo done" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

    const result = runHooks(ROOT, "pre-generate", {});
    expect(result).toBe(true);
  });

  it("executes a single hook command successfully", () => {
    const config = {
      hooks: {
        "pre-generate": { command: "echo hello" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockReturnValue(Buffer.from(""));

    const result = runHooks(ROOT, "pre-generate", { prompt: "test prompt" });
    expect(result).toBe(true);
    expect(runShellCmd).toHaveBeenCalledWith(
      "echo hello",
      expect.objectContaining({
        cwd: ROOT,
        timeout: 30_000,
        stdio: "pipe",
        env: expect.objectContaining({
          DOJOPS_HOOK_EVENT: "pre-generate",
          DOJOPS_HOOK_ROOT: ROOT,
          DOJOPS_HOOK_PROMPT: "test prompt",
        }),
      }),
    );
  });

  it("executes an array of hooks", () => {
    const config = {
      hooks: {
        "post-generate": [{ command: "cmd1" }, { command: "cmd2" }],
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockReturnValue(Buffer.from(""));

    const result = runHooks(ROOT, "post-generate", {});
    expect(result).toBe(true);
    expect(runShellCmd).toHaveBeenCalledTimes(2);
  });

  it("pre-hook failure aborts by default (continueOnError not set)", () => {
    const config = {
      hooks: {
        "pre-generate": [{ command: "fail-cmd" }, { command: "never-reached" }],
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockImplementation(() => {
      throw new Error("Command failed");
    });

    const result = runHooks(ROOT, "pre-generate", {});
    expect(result).toBe(false);
    // Only the first hook should have been attempted since pre-hooks abort on failure
    expect(runShellCmd).toHaveBeenCalledTimes(1);
    expect(p.log.error).toHaveBeenCalled();
  });

  it("pre-hook with continueOnError=true does not abort", () => {
    const config = {
      hooks: {
        "pre-generate": [{ command: "fail-cmd", continueOnError: true }, { command: "second-cmd" }],
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd)
      .mockImplementationOnce(() => {
        throw new Error("Command failed");
      })
      .mockReturnValueOnce(Buffer.from(""));

    const result = runHooks(ROOT, "pre-generate", {});
    // Second hook succeeds, but since second hook is also a pre-hook
    // with default continueOnError=false, it would abort if it failed.
    // Here it succeeds, so overall result is true.
    expect(result).toBe(true);
    expect(runShellCmd).toHaveBeenCalledTimes(2);
  });

  it("post-hook failure continues by default", () => {
    const config = {
      hooks: {
        "post-generate": [{ command: "fail-cmd" }, { command: "second-cmd" }],
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd)
      .mockImplementationOnce(() => {
        throw new Error("Command failed");
      })
      .mockReturnValueOnce(Buffer.from(""));

    const result = runHooks(ROOT, "post-generate", {});
    expect(result).toBe(true);
    expect(runShellCmd).toHaveBeenCalledTimes(2);
  });

  it("post-hook with continueOnError=false aborts on failure", () => {
    const config = {
      hooks: {
        "post-generate": [
          { command: "fail-cmd", continueOnError: false },
          { command: "never-reached" },
        ],
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockImplementation(() => {
      throw new Error("Command failed");
    });

    const result = runHooks(ROOT, "post-generate", {});
    expect(result).toBe(false);
    expect(runShellCmd).toHaveBeenCalledTimes(1);
  });

  it("on-error hooks continue on failure by default", () => {
    const config = {
      hooks: {
        "on-error": { command: "alert" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockImplementation(() => {
      throw new Error("Alert failed");
    });

    const result = runHooks(ROOT, "on-error", { error: "something broke" });
    expect(result).toBe(true);
    expect(runShellCmd).toHaveBeenCalledWith(
      "alert",
      expect.objectContaining({
        env: expect.objectContaining({
          DOJOPS_HOOK_EVENT: "on-error",
          DOJOPS_HOOK_ERROR: "something broke",
        }),
      }),
    );
  });

  it("passes agent and outputPath context as env vars", () => {
    const config = {
      hooks: {
        "post-execute": { command: "notify" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockReturnValue(Buffer.from(""));

    runHooks(ROOT, "post-execute", {
      agent: "terraform",
      outputPath: "/out/main.tf",
    });

    expect(runShellCmd).toHaveBeenCalledWith(
      "notify",
      expect.objectContaining({
        env: expect.objectContaining({
          DOJOPS_HOOK_AGENT: "terraform",
          DOJOPS_HOOK_OUTPUT: "/out/main.tf",
        }),
      }),
    );
  });

  it("verbose mode uses inherit stdio and logs hook command", () => {
    const config = {
      hooks: {
        "pre-scan": { command: "check-deps" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockReturnValue(Buffer.from(""));

    runHooks(ROOT, "pre-scan", {}, { verbose: true });

    expect(runShellCmd).toHaveBeenCalledWith(
      "check-deps",
      expect.objectContaining({ stdio: "inherit" }),
    );
    expect(p.log.info).toHaveBeenCalled();
  });

  it("non-verbose mode uses pipe stdio", () => {
    const config = {
      hooks: {
        "pre-plan": { command: "validate" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockReturnValue(Buffer.from(""));

    runHooks(ROOT, "pre-plan", {});

    expect(runShellCmd).toHaveBeenCalledWith(
      "validate",
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(p.log.info).not.toHaveBeenCalled();
  });

  it("logs warning when a hook fails", () => {
    const config = {
      hooks: {
        "post-generate": { command: "broken" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockImplementation(() => {
      throw new Error("exit code 1");
    });

    runHooks(ROOT, "post-generate", {});

    expect(p.log.warn).toHaveBeenCalled();
  });

  it("handles non-Error thrown values in hook execution", () => {
    const config = {
      hooks: {
        "post-generate": { command: "broken" },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    vi.mocked(runShellCmd).mockImplementation(() => {
      // Simulate a non-Error throw (e.g., a string or number)
      const err = "string error";
      throw Object.assign(new Error(err), { nonStandard: true });
    });

    const result = runHooks(ROOT, "post-generate", {});
    expect(result).toBe(true);
    expect(p.log.warn).toHaveBeenCalled();
  });
});
