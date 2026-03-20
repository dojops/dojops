import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const CLI_PATH = path.resolve(__dirname, "..", "..", "dist", "index.js");

function run(...args: string[]): string {
  try {
    return execFileSync("node", [CLI_PATH, ...args], {
      // NOSONAR — S4721: test helper, execFileSync with array args
      encoding: "utf-8",
      env: { ...process.env, DOJOPS_PROVIDER: "ollama" },
      timeout: 5000,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
}

function expectHelpContains(command: string, expected: string[], notExpected: string[] = []) {
  const output = run(command, "--help");
  for (const s of expected) expect(output).toContain(s);
  for (const s of notExpected) expect(output).not.toContain(s);
}

function expectRunContains(args: string[], expected: string[]) {
  const output = run(...args);
  for (const s of expected) expect(output).toContain(s);
}

describe("CLI", () => {
  describe("--help", () => {
    it("shows help text with --help flag", () => {
      const output = run("--help");
      expect(output).toContain("dojops");
      expect(output).toContain("USAGE");
      expect(output).toContain("COMMANDS");
      expect(output).toContain("auth");
      expect(output).toContain("serve");
      expect(output).toContain("plan");
      expect(output).toContain("--execute");
      expect(output).toContain("debug ci");
      expect(output).toContain("analyze diff");
      expect(output).toContain("skills");
      expect(output).toContain("--port=N");
      expect(output).toContain("--model=NAME");
      expect(output).toContain("--provider=NAME");
    });

    it("shows help text with -h flag", () => {
      const output = run("-h");
      expect(output).toContain("USAGE");
    });
  });

  describe("no arguments", () => {
    it("shows help when no prompt is given", () => {
      const output = run();
      expect(output).toContain("USAGE");
    });
  });

  describe("examples in help", () => {
    it("shows usage examples and config precedence", () => {
      const output = run("--help");
      expect(output).toContain("dojops serve");
      expect(output).toContain("dojops serve --port=8080");
      expect(output).toContain("dojops plan");
      expect(output).toContain("plan --execute --yes");
      expect(output).toContain("CONFIGURATION PRECEDENCE");
      expect(output).toContain("BACKWARD COMPATIBILITY");
      expect(output).toContain("dojops auth login");
    });
  });

  describe("config command", () => {
    it("shows config command in help", () => {
      const output = run("--help");
      expect(output).toContain("config");
      expect(output).toContain("config profile create");
    });

    it("config --show displays configuration (legacy)", () => {
      const output = run("config", "--show");
      expect(output).toContain("Configuration");
      expect(output).toContain("Provider:");
      expect(output).toContain("Model:");
      expect(output).toContain("Tokens:");
    });

    it("config show displays configuration (new)", () => {
      const output = run("config", "show");
      expect(output).toContain("Configuration");
      expect(output).toContain("Provider:");
    });

    it("config --provider sets provider directly", () => {
      const output = run("config", "--provider", "anthropic");
      expect(output).toContain("Configuration saved");
    });
  });

  describe("login backward compat", () => {
    it("shows config suggestion when login has no --token", () => {
      const output = run("login");
      expect(output).toContain("dojops config");
    });
  });

  describe("per-command help", () => {
    /** Data-driven: [command, expectedStrings, notExpectedStrings?] */
    const helpCases: Array<[string, string[], string[]?]> = [
      ["plan", ["dojops plan", "--execute", "--yes", "EXAMPLES"], ["COMMANDS"]],
      ["apply", ["dojops apply", "--dry-run", "--resume", "--yes"]],
      ["serve", ["dojops serve", "--port=N", "ENDPOINTS"]],
      ["debug", ["dojops debug ci", "log"]],
      ["agents", ["dojops agents", "list", "info"]],
      ["config", ["dojops config", "profile", "--token=KEY"]],
      ["history", ["dojops history", "verify", "show"]],
      ["inspect", ["dojops inspect", "config", "session"]],
      ["init", ["dojops init", ".dojops/"]],
      ["status", ["dojops status", "diagnostics"]],
      ["clean", ["dojops clean", "--dry-run"]],
      ["rollback", ["dojops rollback", "--dry-run"]],
      ["generate", ["dojops generate", "default command"]],
      ["explain", ["dojops explain", "plan-id"]],
      ["validate", ["dojops validate", "plan-id"]],
      ["auth", ["dojops auth", "login", "status"]],
      ["analyze", ["dojops analyze diff", "risk"]],
      ["skills", ["dojops skills", "list", "init", "validate", "publish"]],
    ];

    for (const [cmd, expected, notExpected] of helpCases) {
      it(`shows ${cmd}-specific help with dojops ${cmd} --help`, () => {
        expectHelpContains(cmd, expected, notExpected);
      });
    }

    it("shows plan-specific help with dojops plan -h", () => {
      const output = run("plan", "-h");
      expect(output).toContain("dojops plan");
      expect(output).toContain("--execute");
    });

    it("shows status help via doctor alias with dojops doctor --help", () => {
      expectHelpContains("doctor", ["dojops status", "diagnostics"]);
    });

    it("shows destroy as deprecated alias for clean", () => {
      expectHelpContains("destroy", ["clean", "--dry-run"]);
    });
  });

  describe("subcommand routing", () => {
    it("status runs without LLM provider", () => {
      expectRunContains(["status"], ["Node.js version", "System Diagnostics"]);
    });

    it("doctor alias still works", () => {
      expectRunContains(["doctor"], ["Node.js version", "System Diagnostics"]);
    });

    it("init creates .dojops directory or reports already initialized", () => {
      const output = run("init", "--skip-scan", "--skip-tools");
      expect(output.includes("initialized") || output.includes("Initialized")).toBe(true);
    });

    it("skills list runs without error", () => {
      const output = run("skills", "list");
      // May find user-installed skills or report none — either is valid
      expect(output.includes("Skills") || output.includes("No custom skills")).toBe(true);
    });
  });
});
