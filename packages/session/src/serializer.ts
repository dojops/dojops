import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteFileSync } from "@dojops/sdk";
import { ChatSessionState } from "./types";

function sessionsDir(rootDir: string): string {
  return path.join(rootDir, ".dojops", "sessions");
}

export function generateSessionId(): string {
  return `chat-${crypto.randomUUID().slice(0, 8)}`;
}

export function saveSession(rootDir: string, session: ChatSessionState): void {
  const dir = sessionsDir(rootDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${session.id}.json`);
  const toSave = { ...session, updatedAt: new Date().toISOString() };
  atomicWriteFileSync(file, JSON.stringify(toSave, null, 2) + "\n");
}

export function loadSession(rootDir: string, sessionId: string): ChatSessionState | null {
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
  const file = path.join(sessionsDir(rootDir), `${sessionId}.json`);
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}
