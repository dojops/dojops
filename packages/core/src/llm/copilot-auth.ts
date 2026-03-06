/**
 * GitHub Copilot OAuth Device Flow Authentication
 *
 * Flow overview:
 * 1. Request device code from GitHub using Copilot's public client_id
 * 2. User opens browser and enters the code at github.com/login/device
 * 3. Poll GitHub for access token
 * 4. Exchange GitHub OAuth token for Copilot API token (JWT)
 * 5. Use Copilot JWT to call the Copilot chat/completions API
 *
 * The Copilot JWT is short-lived (~30 min) and must be refreshed.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { mkdirOwnerOnly, writeFileOwnerOnly } from "../secure-fs";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * GitHub Copilot's public OAuth client ID.
 * This is the same client_id hardcoded in official Copilot extensions
 * (VS Code, Neovim, JetBrains, etc.). It's public and safe to embed.
 */
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_USER_URL = "https://api.github.com/copilot_internal/user";

const COPILOT_HEADERS = {
  "editor-version": "vscode/1.95.0",
  "editor-plugin-version": "copilot/1.250.0",
  "user-agent": "GithubCopilot/1.250.0",
  "Copilot-Integration-Id": "vscode-chat",
};

function getTokenDir(): string {
  return path.join(os.homedir(), ".dojops");
}

function getTokenFile(): string {
  return path.join(getTokenDir(), "copilot-token.json");
}

// ─── SSRF Protection ────────────────────────────────────────────────────────

const ALLOWED_COPILOT_HOSTS = [".github.com", ".githubcopilot.com", ".githubusercontent.com"];

function isValidCopilotApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_COPILOT_HOSTS.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface CopilotToken {
  token: string;
  expires_at: number;
  endpoints?: {
    api: string;
    proxy: string;
  };
}

export interface CopilotUserInfo {
  chat_enabled: boolean;
  copilot_plan: string;
  endpoints: {
    api: string;
    proxy: string;
    telemetry: string;
  };
}

export interface StoredCopilotAuth {
  github_token: string;
  copilot_token?: string;
  copilot_token_expires_at?: number;
  api_base_url?: string;
  copilot_plan?: string;
}

// ─── Step 1: Request Device Code ─────────────────────────────────────────────

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...COPILOT_HEADERS,
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to request device code: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

// ─── Step 2: Poll for OAuth Access Token ─────────────────────────────────────

export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onStatus?: (status: string) => void,
): Promise<OAuthTokenResponse> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (data.access_token) {
      return data as unknown as OAuthTokenResponse;
    }

    switch (data.error) {
      case "authorization_pending":
        onStatus?.("Waiting for user authorization...");
        break;
      case "slow_down":
        pollInterval = Math.min(pollInterval + 5000, 30_000); // Cap per RFC 8628
        onStatus?.(`Slowing down, new interval: ${pollInterval / 1000}s`);
        break;
      case "expired_token":
        throw new Error("Device code expired. Please restart the login flow.");
      case "access_denied":
        throw new Error("User denied authorization.");
      default:
        throw new Error(`OAuth error: ${data.error} - ${data.error_description}`);
    }
  }

  throw new Error("Timed out waiting for user authorization.");
}

// ─── Step 3: Exchange GitHub Token → Copilot JWT ─────────────────────────────

export async function getCopilotToken(githubToken: string): Promise<CopilotToken> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      ...COPILOT_HEADERS,
    },
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "GitHub token is invalid or expired. Run: dojops auth login --provider github-copilot",
      );
    }
    if (res.status === 403) {
      throw new Error(
        "Access denied. Make sure your GitHub account has an active Copilot subscription.",
      );
    }
    const body = await res.text();
    throw new Error(`Failed to get Copilot token: ${res.status} ${body}`);
  }

  return res.json() as Promise<CopilotToken>;
}

// ─── Step 4: Get User Info (subscription check + endpoints) ──────────────────

export async function getCopilotUserInfo(githubToken: string): Promise<CopilotUserInfo> {
  const res = await fetch(COPILOT_USER_URL, {
    method: "GET",
    headers: {
      Authorization: `token ${githubToken}`,
      Accept: "application/json",
      ...COPILOT_HEADERS,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to get Copilot user info: ${res.status}`);
  }

  return res.json() as Promise<CopilotUserInfo>;
}

// ─── Token Persistence ───────────────────────────────────────────────────────

export function saveCopilotAuth(auth: StoredCopilotAuth): void {
  if (!fs.existsSync(getTokenDir())) {
    mkdirOwnerOnly(getTokenDir());
  }
  // Atomic write: tmp + rename to prevent corruption on kill
  const tmpFile = getTokenFile() + ".tmp";
  writeFileOwnerOnly(tmpFile, JSON.stringify(auth, null, 2) + "\n");
  fs.renameSync(tmpFile, getTokenFile());
}

// Validate GitHub token format (ghu_, gho_, ghp_ prefixes, or legacy tokens)
const GITHUB_TOKEN_PATTERN = /^(gh[uposr]_\w{4,}|[a-f0-9]{40})$/;

export function loadCopilotAuth(): StoredCopilotAuth | null {
  try {
    if (!fs.existsSync(getTokenFile())) return null;
    const data = JSON.parse(fs.readFileSync(getTokenFile(), "utf-8"));
    if (typeof data !== "object" || data === null || !data.github_token) return null;
    // Validate token format to prevent using malformed tokens
    if (!GITHUB_TOKEN_PATTERN.test(data.github_token)) return null;
    // SSRF protection: validate api_base_url from disk
    if (data.api_base_url && !isValidCopilotApiUrl(data.api_base_url)) {
      return null;
    }
    return data as StoredCopilotAuth;
  } catch {
    return null;
  }
}

export function clearCopilotAuth(): void {
  try {
    fs.unlinkSync(getTokenFile());
  } catch {
    // ignore
  }
}

export function isCopilotAuthenticated(): boolean {
  return loadCopilotAuth() !== null;
}

// ─── High-Level: Full Login Flow ─────────────────────────────────────────────

export interface LoginCallbacks {
  onDeviceCode: (userCode: string, verificationUri: string) => void;
  onStatus?: (message: string) => void;
}

export async function copilotLogin(callbacks: LoginCallbacks): Promise<StoredCopilotAuth> {
  const deviceCode = await requestDeviceCode();

  callbacks.onDeviceCode(deviceCode.user_code, deviceCode.verification_uri);

  const oauthToken = await pollForAccessToken(
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in,
    callbacks.onStatus,
  );

  callbacks.onStatus?.("Authorization received! Verifying Copilot subscription...");

  const userInfo = await getCopilotUserInfo(oauthToken.access_token);

  if (!userInfo.chat_enabled) {
    throw new Error(
      "Your GitHub account does not have Copilot Chat enabled. " +
        "Please ensure you have an active Copilot Pro, Pro+, Business, or Enterprise subscription.",
    );
  }

  const copilotToken = await getCopilotToken(oauthToken.access_token);

  const auth: StoredCopilotAuth = {
    github_token: oauthToken.access_token,
    copilot_token: copilotToken.token,
    copilot_token_expires_at: copilotToken.expires_at,
    api_base_url: userInfo.endpoints?.api || "https://api.githubcopilot.com",
    copilot_plan: userInfo.copilot_plan,
  };

  saveCopilotAuth(auth);

  callbacks.onStatus?.(`Authenticated! Plan: ${userInfo.copilot_plan}, API: ${auth.api_base_url}`);

  return auth;
}

// ─── High-Level: Get Valid Copilot Token (auto-refresh) ──────────────────────

// Module-level JWT cache for env-var-based token path (avoids exchanging on every generate() call)
let envTokenCache: { token: string; apiBaseUrl: string; expiresAt: number } | null = null;

// Module-level refresh lock to prevent token stampede on concurrent requests
let refreshPromise: Promise<{ token: string; apiBaseUrl: string }> | null = null;

/** Reset the env token cache (for testing only). */
export function resetEnvTokenCache(): void {
  envTokenCache = null;
  refreshPromise = null;
}

const DEFAULT_COPILOT_API_URL = "https://api.githubcopilot.com";

/** Validate and return a safe API base URL. */
function safeApiBaseUrl(url: string | undefined): string {
  if (!url) return DEFAULT_COPILOT_API_URL;
  return isValidCopilotApiUrl(url) ? url : DEFAULT_COPILOT_API_URL;
}

export async function getValidCopilotToken(): Promise<{ token: string; apiBaseUrl: string }> {
  // Allow env-var-based token for CI/CD
  const envToken = process.env.GITHUB_COPILOT_TOKEN;
  if (envToken) {
    // Validate env var format
    if (!GITHUB_TOKEN_PATTERN.test(envToken)) {
      throw new Error(
        "GITHUB_COPILOT_TOKEN has an invalid format. Expected a GitHub OAuth token (ghu_*, gho_*, ghp_*).",
      );
    }
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 60;
    // Return cached JWT if still valid
    if (envTokenCache && envTokenCache.expiresAt - bufferSeconds > now) {
      return { token: envTokenCache.token, apiBaseUrl: envTokenCache.apiBaseUrl };
    }
    // Env var provides a GitHub OAuth token; exchange it for a Copilot JWT
    const copilotToken = await getCopilotToken(envToken);
    const apiBaseUrl = safeApiBaseUrl(copilotToken.endpoints?.api);
    envTokenCache = { token: copilotToken.token, apiBaseUrl, expiresAt: copilotToken.expires_at };
    return { token: copilotToken.token, apiBaseUrl };
  }

  const auth = loadCopilotAuth();
  if (!auth) {
    throw new Error(
      "Not authenticated with GitHub Copilot. Run: dojops auth login --provider github-copilot",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const bufferSeconds = 60;

  if (
    auth.copilot_token &&
    auth.copilot_token_expires_at &&
    auth.copilot_token_expires_at - bufferSeconds > now
  ) {
    return {
      token: auth.copilot_token,
      apiBaseUrl: safeApiBaseUrl(auth.api_base_url),
    };
  }

  // Token expired — use lock to prevent concurrent refresh stampede
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const copilotToken = await getCopilotToken(auth.github_token);
      auth.copilot_token = copilotToken.token;
      auth.copilot_token_expires_at = copilotToken.expires_at;
      saveCopilotAuth(auth);
      return {
        token: copilotToken.token,
        apiBaseUrl: safeApiBaseUrl(auth.api_base_url),
      };
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
