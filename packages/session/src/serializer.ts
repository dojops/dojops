import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteFileSync } from "@dojops/sdk";
import { ChatSessionState } from "./types";

const SESSION_ID_PATTERN = /^chat-[a-f0-9]{8,16}$/;

function isValidSessionId(id: string): boolean {
  return SESSION_ID_PATTERN.test(id);
}

function sessionsDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", "sessions");
}

// ── H-2: Session file encryption at rest ─────────────────────────────

const ENCRYPTION_ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended
const TAG_LENGTH = 16;

/** Derive a 32-byte key from the user-provided secret using SHA-256. */
function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

/** Get the encryption key from env, or null if encryption is disabled. */
function getEncryptionKey(): Buffer | null {
  const secret = process.env.DOJOPS_SESSION_KEY;
  if (!secret) return null;
  return deriveKey(secret);
}

/** Encrypt a JSON string with AES-256-GCM. Returns base64-encoded ciphertext with IV+tag prepended. */
function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/** Decrypt a base64-encoded ciphertext. Returns the original JSON string. */
function decrypt(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, "base64");
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted session data: too short");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf-8");
}

export function generateSessionId(): string {
  return `chat-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function saveSession(rootDir: string, session: ChatSessionState): void {
  const dir = sessionsDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.json`);
  const toSave = { ...session, updatedAt: new Date().toISOString() };
  const json = JSON.stringify(toSave, null, 2) + "\n";

  const key = getEncryptionKey();
  if (key) {
    // H-2: Write encrypted session with DOJOPS_ENC prefix marker
    const encrypted = encrypt(json, key);
    atomicWriteFileSync(file, `DOJOPS_ENC:${encrypted}`);
  } else {
    atomicWriteFileSync(file, json);
  }
}

export function loadSession(rootDir: string, sessionId: string): ChatSessionState | null {
  if (!isValidSessionId(sessionId)) return null;
  const file = path.join(sessionsDir(rootDir), `${sessionId}.json`);
  try {
    const raw = fs.readFileSync(file, "utf-8");
    if (raw.startsWith("DOJOPS_ENC:")) {
      const key = getEncryptionKey();
      if (!key) {
        console.warn(`[session] Encrypted session ${sessionId} but DOJOPS_SESSION_KEY not set`);
        return null;
      }
      const json = decrypt(raw.slice("DOJOPS_ENC:".length), key);
      return JSON.parse(json) as ChatSessionState;
    }
    return JSON.parse(raw) as ChatSessionState;
  } catch {
    return null;
  }
}

export function listSessions(rootDir: string): ChatSessionState[] {
  const dir = sessionsDir(rootDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => {
      const sessionId = f.replace(/\.json$/, "");
      return isValidSessionId(sessionId);
    })
    .map((f) => {
      try {
        const raw = fs.readFileSync(path.join(dir, f), "utf-8");
        if (raw.startsWith("DOJOPS_ENC:")) {
          const key = getEncryptionKey();
          if (!key) return null;
          const json = decrypt(raw.slice("DOJOPS_ENC:".length), key);
          return JSON.parse(json) as ChatSessionState;
        }
        return JSON.parse(raw) as ChatSessionState;
      } catch {
        return null;
      }
    })
    .filter((s): s is ChatSessionState => s !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function deleteSession(rootDir: string, sessionId: string): boolean {
  if (!isValidSessionId(sessionId)) return false;
  const file = path.join(sessionsDir(rootDir), `${sessionId}.json`);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// ── E-4: Session TTL with auto-cleanup ────────────────────────────

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Delete session files older than the given TTL.
 * Returns the number of deleted sessions.
 *
 * TTL defaults to 7 days (604800000ms) and can be overridden via
 * the `DOJOPS_SESSION_TTL_MS` environment variable.
 */
export function cleanExpiredSessions(rootDir: string, ttlMs?: number): number {
  const ttl =
    ttlMs ??
    (process.env.DOJOPS_SESSION_TTL_MS
      ? Number.parseInt(process.env.DOJOPS_SESSION_TTL_MS, 10)
      : DEFAULT_SESSION_TTL_MS);

  if (!Number.isFinite(ttl) || ttl <= 0) return 0;

  const dir = sessionsDir(rootDir);
  if (!fs.existsSync(dir)) return 0;

  const now = Date.now();
  let deleted = 0;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const sessionId = file.replace(/\.json$/, "");
    if (!isValidSessionId(sessionId)) continue;

    try {
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      let data: ChatSessionState;
      if (raw.startsWith("DOJOPS_ENC:")) {
        const key = getEncryptionKey();
        if (!key) continue;
        data = JSON.parse(decrypt(raw.slice("DOJOPS_ENC:".length), key));
      } else {
        data = JSON.parse(raw);
      }
      const updatedAt = new Date(data.updatedAt).getTime();
      if (Number.isFinite(updatedAt) && now - updatedAt > ttl) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch {
      // Skip corrupt files
    }
  }

  return deleted;
}
