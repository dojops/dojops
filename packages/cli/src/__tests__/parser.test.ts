import { describe, it, expect } from "vitest";
import {
  parseGlobalOptions,
  parseCommandPath,
  extractFlagValue,
  hasFlag,
  stripFlags,
} from "../parser";

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
  it.each([
    [["plan", "Create CI"], ["plan"], ["Create CI"]],
    [["debug", "ci", "ERROR: tsc failed"], ["debug", "ci"], ["ERROR: tsc failed"]],
    [["analyze", "diff", "terraform output"], ["analyze", "diff"], ["terraform output"]],
    [["Create a Terraform config"], [], ["Create a Terraform config"]],
    [["config", "profile", "staging"], ["config", "profile"], ["staging"]],
    [["agents", "list"], ["agents", "list"], []],
    [["config", "show"], ["config", "show"], []],
    [["tools", "load"], ["tools", "load"], []],
  ] as const)("parses %j correctly", (input, expectedCmd, expectedPos) => {
    const { command, positional } = parseCommandPath([...input]);
    expect(command).toEqual([...expectedCmd]);
    expect(positional).toEqual([...expectedPos]);
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

describe("parseCommandPath — validate subcommand (C2 fix)", () => {
  it("parses 'tools validate my-tool' correctly", () => {
    const result = parseCommandPath(["tools", "validate", "my-tool"]);
    expect(result.command).toEqual(["tools", "validate"]);
    expect(result.positional).toEqual(["my-tool"]);
  });

  it("parses 'tools list' correctly", () => {
    const result = parseCommandPath(["tools", "list"]);
    expect(result.command).toEqual(["tools", "list"]);
    expect(result.positional).toEqual([]);
  });

  it("does not treat unknown words as subcommands", () => {
    const result = parseCommandPath(["tools", "typo"]);
    expect(result.command).toEqual(["tools"]);
    expect(result.positional).toEqual(["typo"]);
  });
});
