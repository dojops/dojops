import { describe, it, expect } from "vitest";
import {
  parseGlobalOptions,
  parseCommandPath,
  extractFlagValue,
  hasFlag,
  stripFlags,
} from "./parser";

describe("parseGlobalOptions", () => {
  it("extracts boolean flags", () => {
    const { globalOpts, remaining } = parseGlobalOptions([
      "--verbose",
      "--debug",
      "--quiet",
      "--no-color",
      "--non-interactive",
      "plan",
      "hello",
    ]);
    expect(globalOpts.verbose).toBe(true);
    expect(globalOpts.debug).toBe(true);
    expect(globalOpts.quiet).toBe(true);
    expect(globalOpts.noColor).toBe(true);
    expect(globalOpts.nonInteractive).toBe(true);
    expect(remaining).toEqual(["plan", "hello"]);
  });

  it("extracts value flags (space-separated)", () => {
    const { globalOpts, remaining } = parseGlobalOptions([
      "--profile",
      "staging",
      "--provider",
      "anthropic",
      "--model",
      "claude-sonnet-4-5-20250929",
      "--output",
      "json",
      "plan",
      "Create CI",
    ]);
    expect(globalOpts.profile).toBe("staging");
    expect(globalOpts.provider).toBe("anthropic");
    expect(globalOpts.model).toBe("claude-sonnet-4-5-20250929");
    expect(globalOpts.output).toBe("json");
    expect(remaining).toEqual(["plan", "Create CI"]);
  });

  it("extracts value flags (equals-separated)", () => {
    const { globalOpts, remaining } = parseGlobalOptions([
      "--profile=staging",
      "--provider=openai",
      "--model=gpt-4o",
      "--output=yaml",
      "generate",
    ]);
    expect(globalOpts.profile).toBe("staging");
    expect(globalOpts.provider).toBe("openai");
    expect(globalOpts.model).toBe("gpt-4o");
    expect(globalOpts.output).toBe("yaml");
    expect(remaining).toEqual(["generate"]);
  });

  it("returns defaults when no flags", () => {
    const { globalOpts, remaining } = parseGlobalOptions(["plan", "Create CI"]);
    expect(globalOpts.verbose).toBe(false);
    expect(globalOpts.debug).toBe(false);
    expect(globalOpts.quiet).toBe(false);
    expect(globalOpts.noColor).toBe(false);
    expect(globalOpts.nonInteractive).toBe(false);
    expect(globalOpts.output).toBe("table");
    expect(remaining).toEqual(["plan", "Create CI"]);
  });
});

describe("parseCommandPath", () => {
  it("parses single command", () => {
    const { command, positional } = parseCommandPath(["plan", "Create CI"]);
    expect(command).toEqual(["plan"]);
    expect(positional).toEqual(["Create CI"]);
  });

  it("parses nested command", () => {
    const { command, positional } = parseCommandPath(["debug", "ci", "ERROR: tsc failed"]);
    expect(command).toEqual(["debug", "ci"]);
    expect(positional).toEqual(["ERROR: tsc failed"]);
  });

  it("parses analyze diff", () => {
    const { command, positional } = parseCommandPath(["analyze", "diff", "terraform output"]);
    expect(command).toEqual(["analyze", "diff"]);
    expect(positional).toEqual(["terraform output"]);
  });

  it("returns empty command for unknown first arg", () => {
    const { command, positional } = parseCommandPath(["Create a Terraform config"]);
    expect(command).toEqual([]);
    expect(positional).toEqual(["Create a Terraform config"]);
  });

  it("parses config profile subcommand", () => {
    const { command, positional } = parseCommandPath(["config", "profile", "staging"]);
    expect(command).toEqual(["config", "profile"]);
    expect(positional).toEqual(["staging"]);
  });

  it("parses agents list", () => {
    const { command, positional } = parseCommandPath(["agents", "list"]);
    expect(command).toEqual(["agents", "list"]);
    expect(positional).toEqual([]);
  });

  it("handles config show", () => {
    const { command, positional } = parseCommandPath(["config", "show"]);
    expect(command).toEqual(["config", "show"]);
    expect(positional).toEqual([]);
  });

  it("parses tools load", () => {
    const { command, positional } = parseCommandPath(["tools", "load"]);
    expect(command).toEqual(["tools", "load"]);
    expect(positional).toEqual([]);
  });
});

describe("extractFlagValue", () => {
  it("extracts --flag value form", () => {
    expect(extractFlagValue(["--port", "8080"], "--port")).toBe("8080");
  });

  it("extracts --flag=value form", () => {
    expect(extractFlagValue(["--port=8080"], "--port")).toBe("8080");
  });

  it("returns undefined when flag not present", () => {
    expect(extractFlagValue(["--other", "val"], "--port")).toBeUndefined();
  });
});

describe("hasFlag", () => {
  it("returns true when flag present", () => {
    expect(hasFlag(["--execute", "--yes"], "--yes")).toBe(true);
  });

  it("returns false when flag absent", () => {
    expect(hasFlag(["--execute"], "--yes")).toBe(false);
  });
});

describe("stripFlags", () => {
  it("strips boolean and value flags, keeps positionals", () => {
    const result = stripFlags(
      ["--execute", "--port", "8080", "Create CI for Node"],
      new Set(["--execute"]),
      new Set(["--port"]),
    );
    expect(result).toEqual(["Create CI for Node"]);
  });
});
