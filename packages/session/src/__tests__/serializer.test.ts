import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  generateSessionId,
  cleanExpiredSessions,
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
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    expect(sessionIds).toEqual(sortedIds);
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

  // ── H-2: Session file encryption at rest ─────────────────────────

  describe("encryption (DOJOPS_SESSION_KEY)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("saves encrypted data and loads it back correctly", () => {
      vi.stubEnv("DOJOPS_SESSION_KEY", "my-secret-key-for-testing");

      const state = makeState("chat-e0c0000011");
      saveSession(tmpDir, state);

      // The file on disk should start with the DOJOPS_ENC: prefix, not plain JSON
      const file = path.join(tmpDir, ".dojops", "sessions", "chat-e0c0000011.json");
      const raw = fs.readFileSync(file, "utf-8");
      expect(raw.startsWith("DOJOPS_ENC:")).toBe(true);
      expect(raw).not.toContain('"messages"');

      // Loading with the same key should return the original session
      const loaded = loadSession(tmpDir, "chat-e0c0000011");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("chat-e0c0000011");
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0].content).toBe("Hello");
      expect(loaded!.mode).toBe("INTERACTIVE");
    });

    it("loading encrypted session without key returns null", () => {
      vi.stubEnv("DOJOPS_SESSION_KEY", "my-secret-key-for-testing");

      const state = makeState("chat-e0c0000022");
      saveSession(tmpDir, state);

      // Remove the key before loading
      vi.stubEnv("DOJOPS_SESSION_KEY", "");

      const loaded = loadSession(tmpDir, "chat-e0c0000022");
      expect(loaded).toBeNull();
    });

    it("unencrypted sessions still load when key is set (backwards compatibility)", () => {
      // Save without encryption
      const state = makeState("chat-b0c0a0a000");
      saveSession(tmpDir, state);

      // Now enable encryption and load the plaintext session
      vi.stubEnv("DOJOPS_SESSION_KEY", "my-secret-key-for-testing");

      const loaded = loadSession(tmpDir, "chat-b0c0a0a000");
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe("chat-b0c0a0a000");
      expect(loaded!.messages).toHaveLength(2);
    });

    it("listSessions returns encrypted sessions when key is set", () => {
      vi.stubEnv("DOJOPS_SESSION_KEY", "list-test-key");

      const s1 = makeState("chat-e0c1a0b001");
      const s2 = makeState("chat-e0c1a0b002");
      saveSession(tmpDir, s1);
      saveSession(tmpDir, s2);

      const sessions = listSessions(tmpDir);
      expect(sessions).toHaveLength(2);
      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual(["chat-e0c1a0b001", "chat-e0c1a0b002"]);
    });

    it("listSessions skips encrypted sessions when key is not set", () => {
      vi.stubEnv("DOJOPS_SESSION_KEY", "list-test-key");

      const encrypted = makeState("chat-e0c00a0001");
      saveSession(tmpDir, encrypted);

      // Remove key, add a plaintext session manually
      vi.stubEnv("DOJOPS_SESSION_KEY", "");

      const plain = makeState("chat-a0b0c00001");
      saveSession(tmpDir, plain);

      const sessions = listSessions(tmpDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe("chat-a0b0c00001");
    });

    it("cleanExpiredSessions handles encrypted files", () => {
      vi.stubEnv("DOJOPS_SESSION_KEY", "cleanup-test-key");

      // Save a session first so the directory exists
      const state = makeState("chat-e0ce0a0001");
      saveSession(tmpDir, state);

      // Write an encrypted file directly with an old updatedAt
      // (saveSession always overwrites updatedAt with current time)
      const file = path.join(tmpDir, ".dojops", "sessions", "chat-e0ce0a0001.json");
      const oldState = { ...state, updatedAt: "2020-01-01T00:00:00.000Z" };
      const json = JSON.stringify(oldState, null, 2) + "\n";
      // Encrypt manually using same crypto approach
      const key = crypto.createHash("sha256").update("cleanup-test-key").digest();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(json, "utf-8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      const encoded = Buffer.concat([iv, tag, encrypted]).toString("base64");
      fs.writeFileSync(file, `DOJOPS_ENC:${encoded}`);

      const deleted = cleanExpiredSessions(tmpDir, 1000); // 1 second TTL
      expect(deleted).toBe(1);
      expect(fs.existsSync(file)).toBe(false);
    });

    it("loading with wrong key returns null (decryption fails gracefully)", () => {
      vi.stubEnv("DOJOPS_SESSION_KEY", "correct-key");

      const state = makeState("chat-bad0e00001");
      saveSession(tmpDir, state);

      // Switch to a different key
      vi.stubEnv("DOJOPS_SESSION_KEY", "wrong-key");

      const loaded = loadSession(tmpDir, "chat-bad0e00001");
      expect(loaded).toBeNull();
    });
  });
});
