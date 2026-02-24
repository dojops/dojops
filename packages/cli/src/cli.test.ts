import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as path from "path";

const CLI_PATH = path.resolve(__dirname, "..", "dist", "index.js");

function run(...args: string[]): string {
  try {
    return execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      env: { ...process.env, DOJOPS_PROVIDER: "ollama" },
      timeout: 5000,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return (e.stdout ?? "") + (e.stderr ?? "");
  }
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
      expect(output).toContain("tools");
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
    it("shows plan-specific help with dojops plan --help", () => {
      const output = run("plan", "--help");
      expect(output).toContain("dojops plan");
      expect(output).toContain("--execute");
      expect(output).toContain("--yes");
      expect(output).toContain("EXAMPLES");
      // Should NOT contain the global commands list
      expect(output).not.toContain("COMMANDS");
    });

    it("shows plan-specific help with dojops plan -h", () => {
      const output = run("plan", "-h");
      expect(output).toContain("dojops plan");
      expect(output).toContain("--execute");
    });

    it("shows apply-specific help with dojops apply --help", () => {
      const output = run("apply", "--help");
      expect(output).toContain("dojops apply");
      expect(output).toContain("--dry-run");
      expect(output).toContain("--resume");
      expect(output).toContain("--yes");
    });

    it("shows serve-specific help with dojops serve --help", () => {
      const output = run("serve", "--help");
      expect(output).toContain("dojops serve");
      expect(output).toContain("--port=N");
      expect(output).toContain("ENDPOINTS");
    });

    it("shows debug-specific help with dojops debug --help", () => {
      const output = run("debug", "--help");
      expect(output).toContain("dojops debug ci");
      expect(output).toContain("log");
    });

    it("shows agents-specific help with dojops agents --help", () => {
      const output = run("agents", "--help");
      expect(output).toContain("dojops agents");
      expect(output).toContain("list");
      expect(output).toContain("info");
    });

    it("shows config-specific help with dojops config --help", () => {
      const output = run("config", "--help");
      expect(output).toContain("dojops config");
      expect(output).toContain("profile");
      expect(output).toContain("--token=KEY");
    });

    it("shows history-specific help with dojops history --help", () => {
      const output = run("history", "--help");
      expect(output).toContain("dojops history");
      expect(output).toContain("verify");
      expect(output).toContain("show");
    });

    it("shows inspect-specific help with dojops inspect --help", () => {
      const output = run("inspect", "--help");
      expect(output).toContain("dojops inspect");
      expect(output).toContain("config");
      expect(output).toContain("session");
    });

    it("shows init-specific help with dojops init --help", () => {
      const output = run("init", "--help");
      expect(output).toContain("dojops init");
      expect(output).toContain(".dojops/");
    });

    it("shows status-specific help with dojops status --help", () => {
      const output = run("status", "--help");
      expect(output).toContain("dojops status");
      expect(output).toContain("diagnostics");
    });

    it("shows status help via doctor alias with dojops doctor --help", () => {
      const output = run("doctor", "--help");
      expect(output).toContain("dojops status");
      expect(output).toContain("diagnostics");
    });

    it("shows destroy-specific help with dojops destroy --help", () => {
      const output = run("destroy", "--help");
      expect(output).toContain("dojops destroy");
      expect(output).toContain("--dry-run");
    });

    it("shows rollback-specific help with dojops rollback --help", () => {
      const output = run("rollback", "--help");
      expect(output).toContain("dojops rollback");
      expect(output).toContain("--dry-run");
    });

    it("shows generate-specific help with dojops generate --help", () => {
      const output = run("generate", "--help");
      expect(output).toContain("dojops generate");
      expect(output).toContain("default command");
    });

    it("shows explain-specific help with dojops explain --help", () => {
      const output = run("explain", "--help");
      expect(output).toContain("dojops explain");
      expect(output).toContain("plan-id");
    });

    it("shows validate-specific help with dojops validate --help", () => {
      const output = run("validate", "--help");
      expect(output).toContain("dojops validate");
      expect(output).toContain("plan-id");
    });

    it("shows auth-specific help with dojops auth --help", () => {
      const output = run("auth", "--help");
      expect(output).toContain("dojops auth");
      expect(output).toContain("login");
      expect(output).toContain("status");
    });

    it("shows analyze-specific help with dojops analyze --help", () => {
      const output = run("analyze", "--help");
      expect(output).toContain("dojops analyze diff");
      expect(output).toContain("risk");
    });

    it("shows tools-specific help with dojops tools --help", () => {
      const output = run("tools", "--help");
      expect(output).toContain("dojops tools");
      expect(output).toContain("install");
      expect(output).toContain("remove");
      expect(output).toContain("clean");
      expect(output).toContain("terraform");
      expect(output).toContain("kubectl");
      expect(output).toContain("AVAILABLE TOOLS");
    });
  });

  describe("subcommand routing", () => {
    it("status runs without LLM provider", () => {
      const output = run("status");
      expect(output).toContain("Node.js version");
      expect(output).toContain("System Diagnostics");
    });

    it("doctor alias still works", () => {
      const output = run("doctor");
      expect(output).toContain("Node.js version");
      expect(output).toContain("System Diagnostics");
    });

    it("init creates .dojops directory or reports already initialized", () => {
      const output = run("init");
      expect(output.includes("initialized") || output.includes("Initialized")).toBe(true);
    });

    it("tools list runs without error", () => {
      const output = run("tools", "list");
      expect(output).toContain("terraform");
      expect(output).toContain("kubectl");
    });
  });
});
