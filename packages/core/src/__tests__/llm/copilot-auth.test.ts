import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";

vi.mock("node:fs");
vi.mock("node:os");

const mockHome = "/home/testuser";

// We need dynamic import to get fresh module state with mocked os.homedir
async function importAuth() {
  return import("../../llm/copilot-auth");
}

describe("copilot-auth", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
    // Reset env
    delete process.env.GITHUB_COPILOT_TOKEN;
    // Reset module-level JWT cache
    const { resetEnvTokenCache } = await import("../../llm/copilot-auth");
    resetEnvTokenCache();
  });

  afterEach(() => {
    delete process.env.GITHUB_COPILOT_TOKEN;
  });

  describe("saveCopilotAuth", () => {
    it("creates directory and writes token file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const { saveCopilotAuth } = await importAuth();
      saveCopilotAuth({
        github_token: "ghu_test123",
        api_base_url: "https://api.githubcopilot.com",
      });

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".dojops"),
        expect.objectContaining({ recursive: true, mode: 0o700 }),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("copilot-token.json"),
        expect.stringContaining("ghu_test123"),
        expect.objectContaining({ mode: 0o600 }),
      );
    });

    it("skips mkdir if directory exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const { saveCopilotAuth } = await importAuth();
      saveCopilotAuth({ github_token: "ghu_test" });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe("loadCopilotAuth", () => {
    it("returns stored auth when file exists", async () => {
      const stored = {
        github_token: "ghu_test123",
        copilot_token: "jwt_abc",
        copilot_token_expires_at: 9999999999,
        api_base_url: "https://api.githubcopilot.com",
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(stored));

      const { loadCopilotAuth } = await importAuth();
      const result = loadCopilotAuth();

      expect(result).toEqual(stored);
    });

    it("returns null when file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { loadCopilotAuth } = await importAuth();
      expect(loadCopilotAuth()).toBeNull();
    });

    it("returns null on malformed JSON", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("not json");

      const { loadCopilotAuth } = await importAuth();
      expect(loadCopilotAuth()).toBeNull();
    });

    it("returns null when data has no github_token", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ some_field: "value" }));

      const { loadCopilotAuth } = await importAuth();
      expect(loadCopilotAuth()).toBeNull();
    });

    it("returns null on null parsed data", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("null");

      const { loadCopilotAuth } = await importAuth();
      expect(loadCopilotAuth()).toBeNull();
    });

    it("returns null on read error", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("EACCES");
      });

      const { loadCopilotAuth } = await importAuth();
      expect(loadCopilotAuth()).toBeNull();
    });
  });

  describe("clearCopilotAuth", () => {
    it("deletes the token file", async () => {
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      const { clearCopilotAuth } = await importAuth();
      clearCopilotAuth();

      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining("copilot-token.json"));
    });

    it("does not throw if file does not exist", async () => {
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const { clearCopilotAuth } = await importAuth();
      expect(() => clearCopilotAuth()).not.toThrow();
    });
  });

  describe("isCopilotAuthenticated", () => {
    it("returns true when auth file exists with valid data", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ github_token: "ghu_test" }));

      const { isCopilotAuthenticated } = await importAuth();
      expect(isCopilotAuthenticated()).toBe(true);
    });

    it("returns false when auth file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { isCopilotAuthenticated } = await importAuth();
      expect(isCopilotAuthenticated()).toBe(false);
    });
  });

  describe("getValidCopilotToken", () => {
    it("uses env var token when GITHUB_COPILOT_TOKEN is set", async () => {
      process.env.GITHUB_COPILOT_TOKEN = "ghu_env_token";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt_from_env",
            expires_at: 9999999999,
            endpoints: { api: "https://api.githubcopilot.com" },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getValidCopilotToken } = await importAuth();
      const result = await getValidCopilotToken();

      expect(result.token).toBe("jwt_from_env");
      expect(result.apiBaseUrl).toBe("https://api.githubcopilot.com");

      vi.unstubAllGlobals();
    });

    it("returns cached token when not expired", async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          github_token: "ghu_test",
          copilot_token: "jwt_cached",
          copilot_token_expires_at: futureExpiry,
          api_base_url: "https://api.githubcopilot.com",
        }),
      );

      const { getValidCopilotToken } = await importAuth();
      const result = await getValidCopilotToken();

      expect(result.token).toBe("jwt_cached");
      expect(result.apiBaseUrl).toBe("https://api.githubcopilot.com");
    });

    it("refreshes token when expired", async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 100; // expired
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          github_token: "ghu_test",
          copilot_token: "jwt_old",
          copilot_token_expires_at: pastExpiry,
          api_base_url: "https://api.githubcopilot.com",
        }),
      );
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt_refreshed",
            expires_at: 9999999999,
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getValidCopilotToken } = await importAuth();
      const result = await getValidCopilotToken();

      expect(result.token).toBe("jwt_refreshed");
      // Should save the refreshed token
      expect(fs.writeFileSync).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("refreshes token when no copilot_token exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          github_token: "ghu_test",
          api_base_url: "https://api.githubcopilot.com",
        }),
      );
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt_new",
            expires_at: 9999999999,
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getValidCopilotToken } = await importAuth();
      const result = await getValidCopilotToken();

      expect(result.token).toBe("jwt_new");

      vi.unstubAllGlobals();
    });

    it("throws when not authenticated", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { getValidCopilotToken } = await importAuth();
      await expect(getValidCopilotToken()).rejects.toThrow("Not authenticated");
    });

    it("defaults apiBaseUrl when not stored", async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          github_token: "ghu_test",
          copilot_token: "jwt_cached",
          copilot_token_expires_at: futureExpiry,
        }),
      );

      const { getValidCopilotToken } = await importAuth();
      const result = await getValidCopilotToken();

      expect(result.apiBaseUrl).toBe("https://api.githubcopilot.com");
    });

    it("uses env token with default apiBaseUrl when no endpoints", async () => {
      process.env.GITHUB_COPILOT_TOKEN = "ghu_env_token";

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt_from_env",
            expires_at: 9999999999,
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getValidCopilotToken } = await importAuth();
      const result = await getValidCopilotToken();

      expect(result.apiBaseUrl).toBe("https://api.githubcopilot.com");

      vi.unstubAllGlobals();
    });
  });

  describe("requestDeviceCode", () => {
    it("sends request to GitHub device code endpoint", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: "dc_test",
            user_code: "ABCD-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 5,
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { requestDeviceCode } = await importAuth();
      const result = await requestDeviceCode();

      expect(result.user_code).toBe("ABCD-1234");
      expect(result.device_code).toBe("dc_test");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://github.com/login/device/code",
        expect.objectContaining({ method: "POST" }),
      );

      vi.unstubAllGlobals();
    });

    it("throws on non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });
      vi.stubGlobal("fetch", mockFetch);

      const { requestDeviceCode } = await importAuth();
      await expect(requestDeviceCode()).rejects.toThrow("Failed to request device code");

      vi.unstubAllGlobals();
    });
  });

  describe("getCopilotToken", () => {
    it("exchanges GitHub token for Copilot JWT", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "jwt_copilot",
            expires_at: 9999999999,
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getCopilotToken } = await importAuth();
      const result = await getCopilotToken("ghu_test");

      expect(result.token).toBe("jwt_copilot");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("copilot_internal/v2/token"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "token ghu_test",
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("throws specific message on 401", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getCopilotToken } = await importAuth();
      await expect(getCopilotToken("bad_token")).rejects.toThrow("invalid or expired");

      vi.unstubAllGlobals();
    });

    it("throws specific message on 403", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getCopilotToken } = await importAuth();
      await expect(getCopilotToken("no_sub")).rejects.toThrow("active Copilot subscription");

      vi.unstubAllGlobals();
    });

    it("throws with body on other error status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal error"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getCopilotToken } = await importAuth();
      await expect(getCopilotToken("ghu_test")).rejects.toThrow("500");

      vi.unstubAllGlobals();
    });
  });

  describe("getCopilotUserInfo", () => {
    it("fetches user info from Copilot API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chat_enabled: true,
            copilot_plan: "pro",
            endpoints: {
              api: "https://api.githubcopilot.com",
              proxy: "https://proxy.githubcopilot.com",
              telemetry: "https://telemetry.githubcopilot.com",
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getCopilotUserInfo } = await importAuth();
      const result = await getCopilotUserInfo("ghu_test");

      expect(result.chat_enabled).toBe(true);
      expect(result.copilot_plan).toBe("pro");

      vi.unstubAllGlobals();
    });

    it("throws on non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      vi.stubGlobal("fetch", mockFetch);

      const { getCopilotUserInfo } = await importAuth();
      await expect(getCopilotUserInfo("ghu_test")).rejects.toThrow("404");

      vi.unstubAllGlobals();
    });
  });
});
