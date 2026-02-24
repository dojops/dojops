import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  resolveProvider,
  resolveModel,
  resolveToken,
  parseFlagValue,
  validateProvider,
} from "./config";

vi.mock("node:fs");
vi.mock("node:os");

const mockHome = "/home/testuser";
const configDir = path.join(mockHome, ".dojops");
const configFile = path.join(configDir, "config.json");

describe("config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
    process.env = { ...originalEnv };
    delete process.env.DOJOPS_PROVIDER;
    delete process.env.DOJOPS_MODEL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getConfigPath", () => {
    it("returns the config file path", () => {
      expect(getConfigPath()).toBe(configFile);
    });
  });

  describe("loadConfig", () => {
    it("returns parsed config when file exists", () => {
      const data = { defaultProvider: "anthropic", tokens: { anthropic: "sk-test" } };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data));
      expect(loadConfig()).toEqual(data);
    });

    it("returns empty object when file does not exist", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(loadConfig()).toEqual({});
    });

    it("returns empty object for invalid JSON", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("not json");
      expect(loadConfig()).toEqual({});
    });

    it("returns empty object for non-object JSON (array)", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("[1,2,3]");
      expect(loadConfig()).toEqual({});
    });
  });

  describe("saveConfig", () => {
    it("creates directory and writes file with correct permissions", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const config = { defaultProvider: "openai", tokens: { openai: "sk-key" } };
      saveConfig(config);

      expect(fs.mkdirSync).toHaveBeenCalledWith(configDir, { recursive: true, mode: 0o700 });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configFile,
        JSON.stringify(config, null, 2) + "\n",
        { encoding: "utf-8", mode: 0o600 },
      );
    });

    it("skips directory creation when it exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      saveConfig({});

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("validateProvider", () => {
    it("accepts valid providers", () => {
      expect(validateProvider("openai")).toBe("openai");
      expect(validateProvider("anthropic")).toBe("anthropic");
      expect(validateProvider("ollama")).toBe("ollama");
    });

    it("throws for invalid provider", () => {
      expect(() => validateProvider("invalid")).toThrow(
        'Unknown provider "invalid". Supported: openai, anthropic, ollama',
      );
    });
  });

  describe("resolveProvider", () => {
    it("uses CLI flag first", () => {
      process.env.DOJOPS_PROVIDER = "ollama";
      const config = { defaultProvider: "anthropic" as const };
      expect(resolveProvider("openai", config)).toBe("openai");
    });

    it("uses env var when no CLI flag", () => {
      process.env.DOJOPS_PROVIDER = "anthropic";
      expect(resolveProvider(undefined, {})).toBe("anthropic");
    });

    it("uses config when no CLI flag or env var", () => {
      expect(resolveProvider(undefined, { defaultProvider: "ollama" })).toBe("ollama");
    });

    it("defaults to openai", () => {
      expect(resolveProvider(undefined, {})).toBe("openai");
    });

    it("throws for invalid provider", () => {
      expect(() => resolveProvider("bad", {})).toThrow('Unknown provider "bad"');
    });
  });

  describe("resolveModel", () => {
    it("uses CLI flag first", () => {
      process.env.DOJOPS_MODEL = "gpt-4o";
      expect(resolveModel("claude-sonnet-4-5-20250929", { defaultModel: "llama3" })).toBe(
        "claude-sonnet-4-5-20250929",
      );
    });

    it("uses env var when no CLI flag", () => {
      process.env.DOJOPS_MODEL = "gpt-4o";
      expect(resolveModel(undefined, {})).toBe("gpt-4o");
    });

    it("uses config when no CLI flag or env var", () => {
      expect(resolveModel(undefined, { defaultModel: "llama3" })).toBe("llama3");
    });

    it("returns undefined when nothing set", () => {
      expect(resolveModel(undefined, {})).toBeUndefined();
    });
  });

  describe("resolveToken", () => {
    it("uses env var for openai", () => {
      process.env.OPENAI_API_KEY = "env-key";
      const config = { tokens: { openai: "config-key" } };
      expect(resolveToken("openai", config)).toBe("env-key");
    });

    it("uses env var for anthropic", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";
      expect(resolveToken("anthropic", { tokens: { anthropic: "config-key" } })).toBe("env-key");
    });

    it("falls back to config token", () => {
      expect(resolveToken("openai", { tokens: { openai: "config-key" } })).toBe("config-key");
    });

    it("returns undefined for ollama", () => {
      expect(resolveToken("ollama", { tokens: { ollama: "key" } })).toBeUndefined();
    });

    it("returns undefined when nothing set", () => {
      expect(resolveToken("openai", {})).toBeUndefined();
    });
  });

  describe("parseFlagValue", () => {
    it("parses --flag=value form", () => {
      expect(parseFlagValue(["--provider=anthropic", "hello"], "--provider")).toBe("anthropic");
    });

    it("parses --flag value form", () => {
      expect(parseFlagValue(["--provider", "anthropic", "hello"], "--provider")).toBe("anthropic");
    });

    it("returns undefined when flag not present", () => {
      expect(parseFlagValue(["hello", "--plan"], "--provider")).toBeUndefined();
    });

    it("returns undefined when --flag is last arg (no value)", () => {
      expect(parseFlagValue(["--provider"], "--provider")).toBeUndefined();
    });
  });
});
