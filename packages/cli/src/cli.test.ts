import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import * as path from "path";

const CLI_PATH = path.resolve(__dirname, "..", "dist", "index.js");

function run(...args: string[]): string {
  try {
    return execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      env: { ...process.env, ODA_PROVIDER: "ollama" },
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
      expect(output).toContain("oda");
      expect(output).toContain("USAGE");
      expect(output).toContain("COMMANDS");
      expect(output).toContain("auth");
      expect(output).toContain("serve");
      expect(output).toContain("plan");
      expect(output).toContain("--execute");
      expect(output).toContain("debug ci");
      expect(output).toContain("analyze diff");
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
      expect(output).toContain("oda serve");
      expect(output).toContain("oda serve --port=8080");
      expect(output).toContain("oda plan");
      expect(output).toContain("plan --execute --yes");
      expect(output).toContain("CONFIGURATION PRECEDENCE");
      expect(output).toContain("BACKWARD COMPATIBILITY");
      expect(output).toContain("oda auth login");
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
      expect(output).toContain("oda config");
    });
  });

  describe("per-command help", () => {
    it("shows plan-specific help with oda plan --help", () => {
      const output = run("plan", "--help");
      expect(output).toContain("oda plan");
      expect(output).toContain("--execute");
      expect(output).toContain("--yes");
      expect(output).toContain("EXAMPLES");
      // Should NOT contain the global commands list
      expect(output).not.toContain("COMMANDS");
    });

    it("shows plan-specific help with oda plan -h", () => {
      const output = run("plan", "-h");
      expect(output).toContain("oda plan");
      expect(output).toContain("--execute");
    });

    it("shows apply-specific help with oda apply --help", () => {
      const output = run("apply", "--help");
      expect(output).toContain("oda apply");
      expect(output).toContain("--dry-run");
      expect(output).toContain("--resume");
      expect(output).toContain("--yes");
    });

    it("shows serve-specific help with oda serve --help", () => {
      const output = run("serve", "--help");
      expect(output).toContain("oda serve");
      expect(output).toContain("--port=N");
      expect(output).toContain("ENDPOINTS");
    });

    it("shows debug-specific help with oda debug --help", () => {
      const output = run("debug", "--help");
      expect(output).toContain("oda debug ci");
      expect(output).toContain("log");
    });

    it("shows agents-specific help with oda agents --help", () => {
      const output = run("agents", "--help");
      expect(output).toContain("oda agents");
      expect(output).toContain("list");
      expect(output).toContain("info");
    });

    it("shows config-specific help with oda config --help", () => {
      const output = run("config", "--help");
      expect(output).toContain("oda config");
      expect(output).toContain("profile");
      expect(output).toContain("--token=KEY");
    });

    it("shows history-specific help with oda history --help", () => {
      const output = run("history", "--help");
      expect(output).toContain("oda history");
      expect(output).toContain("verify");
      expect(output).toContain("show");
    });

    it("shows inspect-specific help with oda inspect --help", () => {
      const output = run("inspect", "--help");
      expect(output).toContain("oda inspect");
      expect(output).toContain("config");
      expect(output).toContain("agents");
      expect(output).toContain("session");
    });

    it("shows init-specific help with oda init --help", () => {
      const output = run("init", "--help");
      expect(output).toContain("oda init");
      expect(output).toContain(".oda/");
    });

    it("shows doctor-specific help with oda doctor --help", () => {
      const output = run("doctor", "--help");
      expect(output).toContain("oda doctor");
      expect(output).toContain("diagnostics");
    });

    it("shows destroy-specific help with oda destroy --help", () => {
      const output = run("destroy", "--help");
      expect(output).toContain("oda destroy");
      expect(output).toContain("--dry-run");
    });

    it("shows rollback-specific help with oda rollback --help", () => {
      const output = run("rollback", "--help");
      expect(output).toContain("oda rollback");
      expect(output).toContain("--dry-run");
    });

    it("shows generate-specific help with oda generate --help", () => {
      const output = run("generate", "--help");
      expect(output).toContain("oda generate");
      expect(output).toContain("default command");
    });

    it("shows explain-specific help with oda explain --help", () => {
      const output = run("explain", "--help");
      expect(output).toContain("oda explain");
      expect(output).toContain("plan-id");
    });

    it("shows validate-specific help with oda validate --help", () => {
      const output = run("validate", "--help");
      expect(output).toContain("oda validate");
      expect(output).toContain("plan-id");
    });

    it("shows auth-specific help with oda auth --help", () => {
      const output = run("auth", "--help");
      expect(output).toContain("oda auth");
      expect(output).toContain("login");
      expect(output).toContain("status");
    });

    it("shows analyze-specific help with oda analyze --help", () => {
      const output = run("analyze", "--help");
      expect(output).toContain("oda analyze diff");
      expect(output).toContain("risk");
    });
  });

  describe("subcommand routing", () => {
    it("doctor runs without LLM provider", () => {
      const output = run("doctor");
      expect(output).toContain("Node.js version");
      expect(output).toContain("System Diagnostics");
    });

    it("init creates .oda directory or reports already initialized", () => {
      const output = run("init");
      expect(output.includes("initialized") || output.includes("Initialized")).toBe(true);
    });
  });
});
