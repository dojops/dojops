import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";

// Mock node:fs and node:os
vi.mock("node:fs");
vi.mock("node:os");

// Mock @clack/prompts — use vi.hoisted so vars are available in factory
const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    success: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@clack/prompts", () => ({
  log: mockLog,
  note: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import { providerCommand } from "../../commands/provider";
import { CLIContext } from "../../types";
import { decrypt } from "../../vault";
import * as clack from "@clack/prompts";

const mockHome = "/home/testuser";

function makeCtx(overrides?: Partial<CLIContext["globalOpts"]>): CLIContext {
  return {
    globalOpts: {
      output: "table",
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: () => {
      throw new Error("not implemented");
    },
  };
}

function mockConfigFile(config: Record<string, unknown>): void {
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
}

function mockNoConfig(): void {
  vi.mocked(fs.readFileSync).mockImplementation(() => {
    throw new Error("ENOENT");
  });
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
}

function getWrittenConfig(): Record<string, unknown> | undefined {
  const calls = vi.mocked(fs.writeFileSync).mock.calls;
  const lastCall = calls.find((c) => String(c[0]).includes("config.json"));
  if (!lastCall) return undefined;
  const parsed = JSON.parse(String(lastCall[1]).trim());
  // Decrypt tokens so assertions can compare plaintext
  if (parsed.tokens && typeof parsed.tokens === "object") {
    for (const [k, v] of Object.entries(parsed.tokens)) {
      if (typeof v === "string") {
        try {
          parsed.tokens[k] = decrypt(v);
        } catch {
          // leave as-is
        }
      }
    }
  }
  return parsed;
}

describe("provider command", () => {
  const originalVaultKey = process.env.DOJOPS_VAULT_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
    process.env.DOJOPS_VAULT_KEY = "test-key";
  });

  afterEach(() => {
    if (originalVaultKey === undefined) {
      delete process.env.DOJOPS_VAULT_KEY;
    } else {
      process.env.DOJOPS_VAULT_KEY = originalVaultKey;
    }
  });

  describe("provider list", () => {
    it("displays all providers with configured status", async () => {
      mockConfigFile({
        defaultProvider: "openai",
        tokens: { openai: "sk-proj-abc123xyz" },
      });

      await providerCommand(["list"], makeCtx());
      expect(clack.note).toHaveBeenCalledTimes(1);
      // Verify the note was called with some content
      const noteContent = vi.mocked(clack.note).mock.calls[0][0];
      expect(noteContent).toContain("openai");
      expect(noteContent).toContain("anthropic");
      expect(noteContent).toContain("ollama");
    });

    it("outputs JSON with --output json", async () => {
      mockConfigFile({
        defaultProvider: "anthropic",
        tokens: { anthropic: "sk-ant-test123" },
      });

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await providerCommand(["list"], makeCtx({ output: "json" }));

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output).toHaveLength(7);
      expect(output.find((p: { name: string }) => p.name === "anthropic").configured).toBe(true);
      expect(output.find((p: { name: string }) => p.name === "anthropic").default).toBe(true);
      expect(output.find((p: { name: string }) => p.name === "openai").configured).toBe(false);
      consoleSpy.mockRestore();
    });

    it("defaults to list when no subcommand given", async () => {
      mockConfigFile({ defaultProvider: "openai", tokens: { openai: "sk-test" } });
      await providerCommand([], makeCtx());
      expect(clack.note).toHaveBeenCalledTimes(1);
    });
  });

  describe("provider default", () => {
    it("sets the default provider", async () => {
      mockConfigFile({ tokens: { anthropic: "sk-ant-test" } });

      await providerCommand(["default", "anthropic"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.defaultProvider).toBe("anthropic");
      expect(mockLog.success).toHaveBeenCalled();
    });

    it("warns when no token is configured", async () => {
      mockConfigFile({});

      await providerCommand(["default", "deepseek"], makeCtx());
      expect(mockLog.warn).toHaveBeenCalled();
      const saved = getWrittenConfig();
      expect(saved?.defaultProvider).toBe("deepseek");
    });

    it("validates provider name", async () => {
      mockConfigFile({});
      await expect(providerCommand(["default", "invalid"], makeCtx())).rejects.toThrow(
        'Unknown provider "invalid"',
      );
    });

    it("requires a provider name", async () => {
      mockConfigFile({});
      await expect(providerCommand(["default"], makeCtx())).rejects.toThrow("Usage:");
    });
  });

  describe("provider --as-default", () => {
    it("sets default provider via flag", async () => {
      mockConfigFile({ tokens: { openai: "sk-test" } });

      await providerCommand(["--as-default", "openai"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.defaultProvider).toBe("openai");
      expect(mockLog.success).toHaveBeenCalled();
    });
  });

  describe("provider add", () => {
    it("saves token and auto-sets default for first provider", async () => {
      mockNoConfig();

      await providerCommand(["add", "openai", "--token", "sk-test123"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.tokens).toEqual({ openai: "sk-test123" });
      expect(saved?.defaultProvider).toBe("openai");
    });

    it("preserves existing default when adding second provider", async () => {
      mockConfigFile({
        defaultProvider: "anthropic",
        tokens: { anthropic: "sk-ant-test" },
      });

      await providerCommand(["add", "openai", "--token", "sk-test123"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.tokens).toEqual({ anthropic: "sk-ant-test", openai: "sk-test123" });
      expect(saved?.defaultProvider).toBe("anthropic");
    });

    it("requires --token in non-interactive mode", async () => {
      mockConfigFile({});
      await expect(
        providerCommand(["add", "openai"], makeCtx({ nonInteractive: true })),
      ).rejects.toThrow("Token required");
    });

    it("prompts for token interactively", async () => {
      mockNoConfig();
      vi.mocked(clack.password).mockResolvedValue("sk-interactive");

      await providerCommand(["add", "openai"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.tokens).toEqual({ openai: "sk-interactive" });
    });

    it("validates provider name", async () => {
      mockConfigFile({});
      await expect(
        providerCommand(["add", "badprovider", "--token", "key"], makeCtx()),
      ).rejects.toThrow('Unknown provider "badprovider"');
    });

    it("handles ollama add without token", async () => {
      mockNoConfig();
      vi.mocked(clack.text).mockResolvedValue("http://localhost:11434");
      await providerCommand(["add", "ollama"], makeCtx());
      expect(mockLog.success).toHaveBeenCalled();
    });

    it("handles ollama add with custom host", async () => {
      mockNoConfig();
      vi.mocked(clack.text).mockResolvedValue("https://ollama.internal:8443");
      vi.mocked(clack.confirm).mockResolvedValue(true);
      await providerCommand(["add", "ollama"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.ollamaHost).toBe("https://ollama.internal:8443");
      expect(mockLog.success).toHaveBeenCalled();
    });

    it("handles ollama add with HTTPS and TLS disabled", async () => {
      mockNoConfig();
      vi.mocked(clack.text).mockResolvedValue("https://ollama.internal:8443");
      vi.mocked(clack.confirm).mockResolvedValue(false);
      await providerCommand(["add", "ollama"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.ollamaHost).toBe("https://ollama.internal:8443");
      expect(saved?.ollamaTlsRejectUnauthorized).toBe(false);
    });

    it("skips host prompt in non-interactive mode for ollama", async () => {
      mockNoConfig();
      await providerCommand(["add", "ollama"], makeCtx({ nonInteractive: true }));
      expect(clack.text).not.toHaveBeenCalled();
      expect(mockLog.success).toHaveBeenCalled();
    });

    it("requires a provider name", async () => {
      mockConfigFile({});
      await expect(providerCommand(["add"], makeCtx())).rejects.toThrow("Usage:");
    });
  });

  describe("provider remove", () => {
    it("removes a provider token", async () => {
      mockConfigFile({
        defaultProvider: "anthropic",
        tokens: { openai: "sk-test", anthropic: "sk-ant-test" },
      });

      await providerCommand(["remove", "openai"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.tokens).toEqual({ anthropic: "sk-ant-test" });
      expect(saved?.defaultProvider).toBe("anthropic");
    });

    it("clears default if removed provider was default", async () => {
      mockConfigFile({
        defaultProvider: "openai",
        tokens: { openai: "sk-test", anthropic: "sk-ant-test" },
      });

      await providerCommand(["remove", "openai"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.defaultProvider).toBeUndefined();
      expect(mockLog.warn).toHaveBeenCalled();
    });

    it("reports when no token is stored", async () => {
      mockConfigFile({});
      await providerCommand(["remove", "deepseek"], makeCtx());
      expect(mockLog.info).toHaveBeenCalled();
    });

    it("rejects removing ollama", async () => {
      mockConfigFile({});
      await providerCommand(["remove", "ollama"], makeCtx());
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("cannot be removed"));
    });

    it("requires a provider name", async () => {
      mockConfigFile({});
      await expect(providerCommand(["remove"], makeCtx())).rejects.toThrow("Usage:");
    });
  });

  describe("provider switch", () => {
    it("switches default via interactive picker", async () => {
      mockConfigFile({
        defaultProvider: "openai",
        tokens: { openai: "sk-test", anthropic: "sk-ant-test" },
      });
      vi.mocked(clack.select).mockResolvedValue("anthropic");

      await providerCommand(["switch"], makeCtx());
      const saved = getWrittenConfig();
      expect(saved?.defaultProvider).toBe("anthropic");
      expect(mockLog.success).toHaveBeenCalled();
    });

    it("rejects in non-interactive mode", async () => {
      mockConfigFile({ tokens: { openai: "sk-test" } });
      await expect(providerCommand(["switch"], makeCtx({ nonInteractive: true }))).rejects.toThrow(
        "interactive mode",
      );
    });

    it("handles cancel", async () => {
      mockConfigFile({ tokens: { openai: "sk-test" } });
      vi.mocked(clack.isCancel).mockReturnValueOnce(true);
      vi.mocked(clack.select).mockResolvedValue(Symbol("cancel"));

      await providerCommand(["switch"], makeCtx());
      expect(mockLog.info).toHaveBeenCalledWith("Cancelled.");
    });
  });
});
