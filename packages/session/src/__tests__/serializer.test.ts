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
} from "../serializer";
import { ChatSessionState } from "../types";

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

  it("generateSessionId returns chat- prefixed 16-char hex string", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^chat-[a-f0-9]{16}$/);
  });

  it("saveSession writes to .dojops/sessions/", () => {
    const state = makeState("chat-abc12345def");
    saveSession(tmpDir, state);
    const file = path.join(tmpDir, ".dojops", "sessions", "chat-abc12345def.json");
    expect(fs.existsSync(file)).toBe(true);
  });

  it("loadSession reads back correctly", () => {
    const state = makeState("chat-10ad12340000");
    saveSession(tmpDir, state);
    const loaded = loadSession(tmpDir, "chat-10ad12340000");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("chat-10ad12340000");
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.mode).toBe("INTERACTIVE");
  });

  it("loadSession returns null for missing session", () => {
    const result = loadSession(tmpDir, "chat-00000000");
    expect(result).toBeNull();
  });

  it("listSessions returns sorted list", () => {
    const s1 = makeState("chat-f1a51000");
    saveSession(tmpDir, s1);

    // Manually overwrite to set a known updatedAt in the past
    const file1 = path.join(tmpDir, ".dojops", "sessions", "chat-f1a51000.json");
    const data1 = JSON.parse(fs.readFileSync(file1, "utf-8"));
    data1.updatedAt = "2024-01-01T00:00:00.000Z";
    fs.writeFileSync(file1, JSON.stringify(data1, null, 2) + "\n");

    const s2 = makeState("chat-5ec00d00");
    saveSession(tmpDir, s2);

    const file2 = path.join(tmpDir, ".dojops", "sessions", "chat-5ec00d00.json");
    const data2 = JSON.parse(fs.readFileSync(file2, "utf-8"));
    data2.updatedAt = "2024-12-31T00:00:00.000Z";
    fs.writeFileSync(file2, JSON.stringify(data2, null, 2) + "\n");

    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0].id).toBe("chat-5ec00d00");
  });

  it("listSessions returns empty array when no sessions", () => {
    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(0);
  });

  it("deleteSession removes file", () => {
    const state = makeState("chat-de112345");
    saveSession(tmpDir, state);
    expect(loadSession(tmpDir, "chat-de112345")).not.toBeNull();
    const deleted = deleteSession(tmpDir, "chat-de112345");
    expect(deleted).toBe(true);
    expect(loadSession(tmpDir, "chat-de112345")).toBeNull();
  });

  it("deleteSession returns false for missing session", () => {
    const result = deleteSession(tmpDir, "chat-00000001");
    expect(result).toBe(false);
  });

  it("loadSession returns null for path traversal session ID", () => {
    const result = loadSession(tmpDir, "chat-../../etc/passwd");
    expect(result).toBeNull();
  });

  it("loadSession returns null for ID with directory separators", () => {
    const result = loadSession(tmpDir, "chat-../../../etc/shadow");
    expect(result).toBeNull();
  });

  it("deleteSession returns false for path traversal session ID", () => {
    const result = deleteSession(tmpDir, "chat-../../etc/passwd");
    expect(result).toBe(false);
  });

  it("deleteSession returns false for ID containing directory separators", () => {
    const result = deleteSession(tmpDir, "chat-../secret");
    expect(result).toBe(false);
  });

  it("concurrent session saves both complete without corruption", async () => {
    const id1 = "chat-aabb00110022";
    const id2 = "chat-ccdd00330044";

    const state1 = makeState(id1);
    state1.messages = [
      { role: "user", content: "Message from session 1", timestamp: "2024-01-01T00:00:00.000Z" },
    ];
    state1.metadata = { totalTokensEstimate: 100, messageCount: 1 };

    const state2 = makeState(id2);
    state2.messages = [
      { role: "user", content: "Message from session 2", timestamp: "2024-01-01T00:00:01.000Z" },
    ];
    state2.metadata = { totalTokensEstimate: 200, messageCount: 1 };

    // Save both sessions concurrently
    await Promise.all([
      Promise.resolve(saveSession(tmpDir, state1)),
      Promise.resolve(saveSession(tmpDir, state2)),
    ]);

    // Both sessions should be loadable
    const loaded1 = loadSession(tmpDir, id1);
    const loaded2 = loadSession(tmpDir, id2);

    expect(loaded1).not.toBeNull();
    expect(loaded2).not.toBeNull();
    expect(loaded1!.id).toBe(id1);
    expect(loaded2!.id).toBe(id2);
    expect(loaded1!.messages[0].content).toBe("Message from session 1");
    expect(loaded2!.messages[0].content).toBe("Message from session 2");
  });

  it("concurrent writes to the same session result in clean last-write-wins", async () => {
    const id = "chat-ee00ff112233";

    const state1 = makeState(id);
    state1.messages = [
      { role: "user", content: "First write", timestamp: "2024-01-01T00:00:00.000Z" },
    ];
    state1.metadata = { totalTokensEstimate: 10, messageCount: 1 };

    const state2 = makeState(id);
    state2.messages = [
      { role: "user", content: "Second write", timestamp: "2024-01-01T00:00:01.000Z" },
      { role: "assistant", content: "Response", timestamp: "2024-01-01T00:00:02.000Z" },
    ];
    state2.metadata = { totalTokensEstimate: 20, messageCount: 2 };

    // Both save concurrently to the same session file
    await Promise.all([
      Promise.resolve(saveSession(tmpDir, state1)),
      Promise.resolve(saveSession(tmpDir, state2)),
    ]);

    // The file should contain valid JSON (not corrupted by interleaving)
    const loaded = loadSession(tmpDir, id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(id);

    // The content should be from either state1 or state2 (last-write-wins),
    // but must be a complete, uncorrupted state
    const messageContents = loaded!.messages.map((m) => m.content);
    const isState1 = messageContents.length === 1 && messageContents[0] === "First write";
    const isState2 = messageContents.length === 2 && messageContents[0] === "Second write";
    expect(isState1 || isState2).toBe(true);
  });

  it("concurrent saves to multiple sessions all appear in listing", async () => {
    const ids = ["chat-1100aabb0011", "chat-2200ccdd0022", "chat-3300eeff0033"];

    await Promise.all(ids.map((id) => Promise.resolve(saveSession(tmpDir, makeState(id)))));

    const sessions = listSessions(tmpDir);
    expect(sessions).toHaveLength(3);
    const sessionIds = sessions.map((s) => s.id).sort((a, b) => a.localeCompare(b));
    expect(sessionIds).toEqual(ids.sort((a, b) => a.localeCompare(b)));
  });

  it("listSessions filters out files with non-hex session IDs", () => {
    // Create sessions directory
    const sessDir = path.join(tmpDir, ".dojops", "sessions");
    fs.mkdirSync(sessDir, { recursive: true });

    // Write a valid session file
    const validId = "chat-abcdef0123456789";
    const validState = makeState(validId);
    fs.writeFileSync(
      path.join(sessDir, `${validId}.json`),
      JSON.stringify(validState, null, 2) + "\n",
    );

    // Write an invalid session file with non-hex characters in the ID
    const invalidId = "chat-ZZZZZZZZ";
    const invalidState = makeState(invalidId);
    fs.writeFileSync(
      path.join(sessDir, `${invalidId}.json`),
      JSON.stringify(invalidState, null, 2) + "\n",
    );

    // Write another file that doesn't match the session ID pattern at all
    const weirdFile = "not-a-session.json";
    fs.writeFileSync(
      path.join(sessDir, weirdFile),
      JSON.stringify({ id: "not-a-session" }, null, 2) + "\n",
    );

    const sessions = listSessions(tmpDir);

    // Only the valid hex session ID should be returned
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(validId);
  });
});
