import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isCopilotAuthenticated } from "@dojops/core";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  resolveProvider,
  resolveModel,
  resolveToken,
  resolveOllamaHost,
  resolveOllamaTls,
  validateProvider,
  loadProfile,
  saveProfile,
  deleteProfile,
  listProfiles,
  getActiveProfile,
  setActiveProfile,
  getConfiguredProviders,
  loadProfileConfig,
} from "../config";

vi.mock("node:fs");
vi.mock("node:os");
vi.mock("@dojops/core", () => ({
  isCopilotAuthenticated: vi.fn(() => false),
}));

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
    delete process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED;
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

  describe("resolveOllamaHost", () => {
    it("uses CLI flag first", () => {
      process.env.OLLAMA_HOST = "http://env:9999";
      expect(resolveOllamaHost("http://cli:8888", { ollamaHost: "http://config:7777" })).toBe(
        "http://cli:8888",
      );
    });

    it("uses env var when no CLI flag", () => {
      process.env.OLLAMA_HOST = "http://env:9999";
      expect(resolveOllamaHost(undefined, { ollamaHost: "http://config:7777" })).toBe(
        "http://env:9999",
      );
    });

    it("uses config when no CLI flag or env var", () => {
      expect(resolveOllamaHost(undefined, { ollamaHost: "https://ollama.corp:8443" })).toBe(
        "https://ollama.corp:8443",
      );
    });

    it("defaults to http://localhost:11434", () => {
      expect(resolveOllamaHost(undefined, {})).toBe("http://localhost:11434");
    });
  });

  describe("resolveOllamaTls", () => {
    it("uses CLI flag first", () => {
      process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED = "true";
      expect(resolveOllamaTls(false, { ollamaTlsRejectUnauthorized: true })).toBe(false);
    });

    it("uses env var when no CLI flag", () => {
      process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED = "false";
      expect(resolveOllamaTls(undefined, { ollamaTlsRejectUnauthorized: true })).toBe(false);
    });

    it("treats env var '0' as false", () => {
      process.env.OLLAMA_TLS_REJECT_UNAUTHORIZED = "0";
      expect(resolveOllamaTls(undefined, {})).toBe(false);
    });

    it("uses config when no CLI flag or env var", () => {
      expect(resolveOllamaTls(undefined, { ollamaTlsRejectUnauthorized: false })).toBe(false);
    });

    it("defaults to true", () => {
      expect(resolveOllamaTls(undefined, {})).toBe(true);
    });
  });

  // ── Profile management ──────────────────────────────────────────────

  const profilesPath = path.join(mockHome, ".dojops", "profiles");
  const metaPath = path.join(mockHome, ".dojops", "meta.json");

  describe("loadProfile", () => {
    it("returns parsed config for an existing profile", () => {
      const data = { defaultProvider: "anthropic" };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(data));
      expect(loadProfile("work")).toEqual(data);
      expect(fs.readFileSync).toHaveBeenCalledWith(path.join(profilesPath, "work.json"), "utf-8");
    });

    it("returns null when profile file does not exist", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(loadProfile("missing")).toBeNull();
    });

    it("throws on invalid profile name", () => {
      expect(() => loadProfile("../evil")).toThrow("Invalid profile name");
    });

    it("throws on empty profile name", () => {
      expect(() => loadProfile("")).toThrow("Invalid profile name");
    });

    it("throws on profile name exceeding 64 characters", () => {
      const longName = "a".repeat(65);
      expect(() => loadProfile(longName)).toThrow("Invalid profile name");
    });

    it("accepts profile names with dashes and underscores", () => {
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
      expect(loadProfile("my-work_profile")).toEqual({});
    });
  });

  describe("saveProfile", () => {
    it("creates profiles directory and writes profile file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const config = { defaultProvider: "openai", tokens: { openai: "sk-key" } };
      saveProfile("work", config);

      expect(fs.mkdirSync).toHaveBeenCalledWith(profilesPath, { recursive: true, mode: 0o700 });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(profilesPath, "work.json"),
        JSON.stringify(config, null, 2) + "\n",
        { encoding: "utf-8", mode: 0o600 },
      );
    });

    it("skips directory creation when profiles dir exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      saveProfile("existing", {});

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it("throws on invalid profile name", () => {
      expect(() => saveProfile("bad name!", {})).toThrow("Invalid profile name");
    });
  });

  describe("deleteProfile", () => {
    it("deletes profile file and returns true", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      // getActiveProfile reads metaFile — return a different active profile
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ activeProfile: "other" }));

      expect(deleteProfile("work")).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(profilesPath, "work.json"));
    });

    it("returns false when profile does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(deleteProfile("missing")).toBe(false);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("clears active profile if deleted profile was active", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ activeProfile: "work" }));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      expect(deleteProfile("work")).toBe(true);
      // Should write meta without activeProfile
      expect(fs.writeFileSync).toHaveBeenCalledWith(metaPath, expect.stringContaining("{"), {
        encoding: "utf-8",
        mode: 0o600,
      });
      // Verify activeProfile was removed from the written JSON
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData.activeProfile).toBeUndefined();
    });

    it("handles missing meta file when deleting active profile", () => {
      // First call to existsSync checks profile file, returns true
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
      // readFileSync for getActiveProfile returns matching name,
      // then readFileSync for clearing throws (no meta file)
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify({ activeProfile: "work" }))
        .mockImplementationOnce(() => {
          throw new Error("ENOENT");
        });

      // Should not throw — the catch block handles the missing meta file
      expect(deleteProfile("work")).toBe(true);
    });

    it("throws on invalid profile name", () => {
      expect(() => deleteProfile("bad/name")).toThrow("Invalid profile name");
    });
  });

  describe("listProfiles", () => {
    it("returns profile names without .json extension", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "dev.json",
        "prod.json",
        "staging.json",
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      expect(listProfiles()).toEqual(["dev", "prod", "staging"]);
    });

    it("filters out non-json files", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "work.json",
        ".DS_Store",
        "notes.txt",
      ] as unknown as ReturnType<typeof fs.readdirSync>);
      expect(listProfiles()).toEqual(["work"]);
    });

    it("returns empty array when profiles directory does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(listProfiles()).toEqual([]);
    });

    it("returns empty array when profiles directory is empty", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);
      expect(listProfiles()).toEqual([]);
    });
  });

  describe("getActiveProfile", () => {
    it("returns active profile name from meta file", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ activeProfile: "production" }));
      expect(getActiveProfile()).toBe("production");
    });

    it("returns undefined when meta file does not exist", () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(getActiveProfile()).toBeUndefined();
    });

    it("returns undefined when meta file has no activeProfile field", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));
      expect(getActiveProfile()).toBeUndefined();
    });
  });

  describe("setActiveProfile", () => {
    it("creates config directory and writes meta file with profile name", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      setActiveProfile("staging");

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join(mockHome, ".dojops"), {
        recursive: true,
        mode: 0o700,
      });
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData.activeProfile).toBe("staging");
    });

    it("preserves existing meta fields when setting profile", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ someField: "value" }));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      setActiveProfile("dev");

      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData.activeProfile).toBe("dev");
      expect(writtenData.someField).toBe("value");
    });

    it("can clear active profile by passing undefined", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ activeProfile: "old" }));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      setActiveProfile(undefined);

      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData.activeProfile).toBeUndefined();
    });

    it("skips directory creation when config dir exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      setActiveProfile("test");

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("getConfiguredProviders", () => {
    it("always includes ollama", () => {
      expect(getConfiguredProviders({})).toContain("ollama");
    });

    it("includes providers with configured tokens", () => {
      const config = { tokens: { openai: "sk-key", anthropic: "ant-key" } };
      const result = getConfiguredProviders(config);
      expect(result).toContain("openai");
      expect(result).toContain("anthropic");
      expect(result).toContain("ollama");
    });

    it("excludes providers with empty token strings", () => {
      const config = { tokens: { openai: "", anthropic: "ant-key" } };
      const result = getConfiguredProviders(config);
      expect(result).not.toContain("openai");
      expect(result).toContain("anthropic");
    });

    it("includes github-copilot when authenticated", () => {
      vi.mocked(isCopilotAuthenticated).mockReturnValue(true);
      const result = getConfiguredProviders({});
      expect(result).toContain("github-copilot");
    });

    it("excludes github-copilot when not authenticated", () => {
      vi.mocked(isCopilotAuthenticated).mockReturnValue(false);
      const result = getConfiguredProviders({});
      expect(result).not.toContain("github-copilot");
    });

    it("returns only ollama when no tokens configured and copilot not authenticated", () => {
      vi.mocked(isCopilotAuthenticated).mockReturnValue(false);
      expect(getConfiguredProviders({})).toEqual(["ollama"]);
    });
  });

  describe("loadProfileConfig", () => {
    it("loads named profile when profileName is given", () => {
      const profileConfig = { defaultProvider: "anthropic" };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(profileConfig));
      expect(loadProfileConfig("work")).toEqual(profileConfig);
    });

    it("falls back to default config when named profile does not exist", () => {
      // First readFileSync for loadProfile — profile not found
      // Second readFileSync for loadConfig — returns default config
      const defaultConfig = { defaultProvider: "openai" };
      vi.mocked(fs.readFileSync)
        .mockImplementationOnce(() => {
          throw new Error("ENOENT");
        })
        .mockReturnValueOnce(JSON.stringify(defaultConfig));

      expect(loadProfileConfig("missing")).toEqual(defaultConfig);
    });

    it("uses active profile when no profileName given", () => {
      const profileConfig = { defaultProvider: "deepseek" };
      // First readFileSync for getActiveProfile (meta.json)
      // Second readFileSync for loadProfile
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify({ activeProfile: "staging" }))
        .mockReturnValueOnce(JSON.stringify(profileConfig));

      expect(loadProfileConfig()).toEqual(profileConfig);
    });

    it("falls back to default config when no profile and no active profile", () => {
      const defaultConfig = { defaultProvider: "openai" };
      // getActiveProfile throws (no meta file) → loadConfig returns default
      vi.mocked(fs.readFileSync)
        .mockImplementationOnce(() => {
          throw new Error("ENOENT");
        })
        .mockReturnValueOnce(JSON.stringify(defaultConfig));

      expect(loadProfileConfig()).toEqual(defaultConfig);
    });

    it("falls back to default config when active profile file is missing", () => {
      const defaultConfig = { defaultModel: "gpt-4o" };
      // getActiveProfile returns "gone"
      // loadProfile("gone") throws — profile file missing
      // loadConfig returns default
      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(JSON.stringify({ activeProfile: "gone" }))
        .mockImplementationOnce(() => {
          throw new Error("ENOENT");
        })
        .mockReturnValueOnce(JSON.stringify(defaultConfig));

      expect(loadProfileConfig()).toEqual(defaultConfig);
    });
  });
});
