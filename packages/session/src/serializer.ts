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

export function generateSessionId(): string {
  return `chat-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function saveSession(rootDir: string, session: ChatSessionState): void {
  const dir = sessionsDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.json`);
  const toSave = { ...session, updatedAt: new Date().toISOString() };
  atomicWriteFileSync(file, JSON.stringify(toSave, null, 2) + "\n");
}

export function loadSession(rootDir: string, sessionId: string): ChatSessionState | null {
  if (!isValidSessionId(sessionId)) return null;
  const file = path.join(sessionsDir(rootDir), `${sessionId}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ChatSessionState;
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
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ChatSessionState;
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
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as ChatSessionState;
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
