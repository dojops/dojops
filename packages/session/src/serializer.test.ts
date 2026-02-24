import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  generateSessionId,
} from "./serializer";
import { ChatSessionState } from "./types";

function makeState(id?: string): ChatSessionState {
  return {
    id: id ?? generateSessionId(),
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    mode: "INTERACTIVE",
    messages: [
      { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { role: "assistant", content: "Hi", timestamp: "2024-01-01T00:00:01.000Z" },
    ],
    metadata: { totalTokensEstimate: 10, messageCount: 2 },
  };
}

describe("serializer", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-session-test-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generateSessionId returns chat- prefixed string", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^chat-[a-f0-9]{8}$/);
  });

  it("saveSession writes to .dojops/sessions/", () => {
    const state = makeState("chat-abc12345");
    saveSession(tmpDir, state);
    const file = path.join(tmpDir, ".dojops", "sessions", "chat-abc12345.json");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("loadSession reads back correctly", () => {
    const state = makeState("chat-load1234");
    saveSession(tmpDir, state);
    const loaded = loadSession(tmpDir, "chat-load1234");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("chat-load1234");
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.mode).toBe("INTERACTIVE");
  });

  it("loadSession returns null for missing session", () => {
    const result = loadSession(tmpDir, "chat-nonexist");
    expect(result).toBeNull();
  });

  it("listSessions returns sorted list", () => {
    const s1 = makeState("chat-first000");
    saveSession(tmpDir, s1);

    // Manually overwrite to set a known updatedAt in the past
    const file1 = path.join(tmpDir, ".dojops", "sessions", "chat-first000.json");
    const data1 = JSON.parse(fs.readFileSync(file1, "utf-8"));
    data1.updatedAt = "2024-01-01T00:00:00.000Z";
    fs.writeFileSync(file1, JSON.stringify(data1, null, 2) + "\n");

    const s2 = makeState("chat-second00");
    saveSession(tmpDir, s2);

    const file2 = path.join(tmpDir, ".dojops", "sessions", "chat-second00.json");
    const data2 = JSON.parse(fs.readFileSync(file2, "utf-8"));
    data2.updatedAt = "2024-12-31T00:00:00.000Z";
    fs.writeFileSync(file2, JSON.stringify(data2, null, 2) + "\n");

    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0].id).toBe("chat-second00");
  });

  it("listSessions returns empty array when no sessions", () => {
    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(0);
  });

  it("deleteSession removes file", () => {
    const state = makeState("chat-del12345");
    saveSession(tmpDir, state);
    expect(loadSession(tmpDir, "chat-del12345")).not.toBeNull();
    const deleted = deleteSession(tmpDir, "chat-del12345");
    expect(deleted).toBe(true);
    expect(loadSession(tmpDir, "chat-del12345")).toBeNull();
  });

  it("deleteSession returns false for missing session", () => {
    const result = deleteSession(tmpDir, "chat-nothere0");
    expect(result).toBe(false);
  });
});
