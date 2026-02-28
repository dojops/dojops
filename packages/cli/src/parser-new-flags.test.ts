import { describe, it, expect } from "vitest";
import { parseGlobalOptions, parseCommandPath } from "./parser";

describe("parseGlobalOptions — new flags", () => {
  describe("--raw (F-7)", () => {
    it("sets raw=true when present", () => {
      const { globalOpts } = parseGlobalOptions(["--raw"]);
      expect(globalOpts.raw).toBe(true);
    });

    it("defaults raw to false", () => {
      const { globalOpts } = parseGlobalOptions([]);
      expect(globalOpts.raw).toBe(false);
    });

    it("--raw anywhere in args", () => {
      const { globalOpts } = parseGlobalOptions(["generate", "--raw", "some prompt"]);
      expect(globalOpts.raw).toBe(true);
    });

    it("--raw combined with --output json", () => {
      const { globalOpts } = parseGlobalOptions(["--raw", "--output", "json"]);
      expect(globalOpts.raw).toBe(true);
      expect(globalOpts.output).toBe("json");
    });

    it("--raw combined with --quiet", () => {
      const { globalOpts } = parseGlobalOptions(["--raw", "--quiet"]);
      expect(globalOpts.raw).toBe(true);
      expect(globalOpts.quiet).toBe(true);
    });
  });

  describe("--fallback-provider (F-2)", () => {
    it("parses space-separated value", () => {
      const { globalOpts } = parseGlobalOptions(["--fallback-provider", "anthropic"]);
      expect(globalOpts.fallbackProvider).toBe("anthropic");
    });

    it("parses equals form", () => {
      const { globalOpts } = parseGlobalOptions(["--fallback-provider=ollama"]);
      expect(globalOpts.fallbackProvider).toBe("ollama");
    });

    it("defaults to undefined", () => {
      const { globalOpts } = parseGlobalOptions([]);
      expect(globalOpts.fallbackProvider).toBeUndefined();
    });

    it("combined with --provider", () => {
      const { globalOpts } = parseGlobalOptions([
        "--provider",
        "openai",
        "--fallback-provider",
        "anthropic",
      ]);
      expect(globalOpts.provider).toBe("openai");
      expect(globalOpts.fallbackProvider).toBe("anthropic");
    });

    it("preserves remaining args", () => {
      const { remaining } = parseGlobalOptions([
        "--fallback-provider",
        "anthropic",
        "generate",
        "Create CI pipeline",
      ]);
      expect(remaining).toEqual(["generate", "Create CI pipeline"]);
    });
  });

  describe("--output yaml (H-2)", () => {
    it("parses --output yaml", () => {
      const { globalOpts } = parseGlobalOptions(["--output", "yaml"]);
      expect(globalOpts.output).toBe("yaml");
    });

    it("parses --output=yaml", () => {
      const { globalOpts } = parseGlobalOptions(["--output=yaml"]);
      expect(globalOpts.output).toBe("yaml");
    });

    it("rejects invalid format", () => {
      expect(() => parseGlobalOptions(["--output", "csv"])).toThrow(
        'Invalid --output value: "csv"',
      );
    });

    it("table is default", () => {
      const { globalOpts } = parseGlobalOptions([]);
      expect(globalOpts.output).toBe("table");
    });

    it("parses --output json", () => {
      const { globalOpts } = parseGlobalOptions(["--output", "json"]);
      expect(globalOpts.output).toBe("json");
    });
  });

  describe("combined flags", () => {
    it("handles all new flags together", () => {
      const { globalOpts, remaining } = parseGlobalOptions([
        "--raw",
        "--fallback-provider",
        "anthropic",
        "--output",
        "yaml",
        "--provider",
        "openai",
        "generate",
        "some prompt",
      ]);
      expect(globalOpts.raw).toBe(true);
      expect(globalOpts.fallbackProvider).toBe("anthropic");
      expect(globalOpts.output).toBe("yaml");
      expect(globalOpts.provider).toBe("openai");
      expect(remaining).toEqual(["generate", "some prompt"]);
    });

    it("-- separator is skipped, subsequent args still parsed", () => {
      const { globalOpts, remaining } = parseGlobalOptions(["--", "--raw", "generate"]);
      expect(globalOpts.raw).toBe(true);
      expect(remaining).toEqual(["generate"]);
    });
  });
});

describe("parseCommandPath — new subcommands", () => {
  it('parses "history repair"', () => {
    const { command, positional } = parseCommandPath(["history", "repair"]);
    expect(command).toEqual(["history", "repair"]);
    expect(positional).toEqual([]);
  });

  it('parses "history repair" with positional args', () => {
    const { command, positional } = parseCommandPath(["history", "repair", "--fix"]);
    expect(command).toEqual(["history", "repair"]);
    expect(positional).toEqual(["--fix"]);
  });

  it('parses "tools validate"', () => {
    const { command } = parseCommandPath(["tools", "validate"]);
    expect(command).toEqual(["tools", "validate"]);
  });

  it('parses "auth logout"', () => {
    const { command } = parseCommandPath(["auth", "logout"]);
    expect(command).toEqual(["auth", "logout"]);
  });

  it('parses "config delete"', () => {
    const { command } = parseCommandPath(["config", "delete"]);
    expect(command).toEqual(["config", "delete"]);
  });

  it("handles unknown command as empty path", () => {
    const { command, positional } = parseCommandPath(["notacommand", "subcommand"]);
    expect(command).toEqual([]);
    expect(positional).toEqual(["notacommand", "subcommand"]);
  });
});
