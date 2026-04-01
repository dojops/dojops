import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SessionJournal } from "../session-journal";

describe("SessionJournal", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-journal-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates journal directory and file on open", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-001" });
    journal.open();
    journal.close();

    const journalDir = path.join(tmpDir, ".dojops", "journals");
    expect(fs.existsSync(journalDir)).toBe(true);
    expect(fs.existsSync(path.join(journalDir, "test-001.jsonl"))).toBe(true);
  });

  it("auto-opens on first append", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-002" });
    journal.writeUserMessage("hello");
    journal.close();

    const entries = journal.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("user");
    expect(entries[0].data.content).toBe("hello");
  });

  it("writes multiple entry types", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-003" });
    journal.writeUserMessage("build a thing");
    journal.writeAssistantMessage("I'll create the file", [
      { id: "c1", name: "write_file", arguments: { path: "/tmp/x.ts" } },
    ]);
    journal.writeToolCall("c1", "write_file", { path: "/tmp/x.ts" });
    journal.writeToolResult("c1", "File written");
    journal.writeCompaction("progressive", 20, 8);
    journal.writeMetadata({ provider: "openai", totalTokens: 5000 });
    journal.close();

    const entries = journal.readAll();
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.type)).toEqual([
      "user",
      "assistant",
      "tool_call",
      "tool_result",
      "compaction",
      "metadata",
    ]);
  });

  it("preserves sessionId on all entries", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-004" });
    journal.writeUserMessage("a");
    journal.writeAssistantMessage("b");
    journal.close();

    const entries = journal.readAll();
    for (const entry of entries) {
      expect(entry.sessionId).toBe("test-004");
    }
  });

  it("adds timestamps to entries", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-005" });
    const before = new Date().toISOString();
    journal.writeUserMessage("test");
    journal.close();

    const entries = journal.readAll();
    expect(entries[0].timestamp).toBeDefined();
    expect(new Date(entries[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime() - 1000,
    );
  });

  it("tracks entry count", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-006" });
    expect(journal.getEntryCount()).toBe(0);
    journal.writeUserMessage("a");
    expect(journal.getEntryCount()).toBe(1);
    journal.writeAssistantMessage("b");
    expect(journal.getEntryCount()).toBe(2);
    journal.close();
  });

  it("resumes with correct entry count", () => {
    const sid = "test-007";
    const j1 = new SessionJournal({ rootDir: tmpDir, sessionId: sid });
    j1.writeUserMessage("first");
    j1.writeAssistantMessage("second");
    j1.close();

    const j2 = new SessionJournal({ rootDir: tmpDir, sessionId: sid });
    j2.open();
    expect(j2.getEntryCount()).toBe(2);
    j2.writeUserMessage("third");
    expect(j2.getEntryCount()).toBe(3);
    j2.close();

    const entries = j2.readAll();
    expect(entries).toHaveLength(3);
  });

  it("returns file path", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-008" });
    expect(journal.getPath()).toContain("test-008.jsonl");
    expect(journal.getPath()).toContain(".dojops/journals");
  });

  it("generates unique session IDs", () => {
    const id1 = SessionJournal.generateId();
    const id2 = SessionJournal.generateId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^journal-[a-f0-9]{16}$/);
  });

  describe("static methods", () => {
    it("checks existence", () => {
      expect(SessionJournal.exists("nonexistent", tmpDir)).toBe(false);

      const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-exists" });
      journal.writeUserMessage("test");
      journal.close();

      expect(SessionJournal.exists("test-exists", tmpDir)).toBe(true);
    });

    it("lists journals sorted by recency", () => {
      const j1 = new SessionJournal({ rootDir: tmpDir, sessionId: "test-list-a" });
      j1.writeUserMessage("old");
      j1.close();

      // Ensure different mtime
      const j2 = new SessionJournal({ rootDir: tmpDir, sessionId: "test-list-b" });
      j2.writeUserMessage("new");
      j2.close();

      const list = SessionJournal.list(tmpDir);
      expect(list).toContain("test-list-a");
      expect(list).toContain("test-list-b");
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it("deletes journals", () => {
      const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-delete" });
      journal.writeUserMessage("doomed");
      journal.close();

      expect(SessionJournal.exists("test-delete", tmpDir)).toBe(true);
      const deleted = SessionJournal.delete("test-delete", tmpDir);
      expect(deleted).toBe(true);
      expect(SessionJournal.exists("test-delete", tmpDir)).toBe(false);
    });

    it("returns false when deleting non-existent journal", () => {
      expect(SessionJournal.delete("nope", tmpDir)).toBe(false);
    });

    it("cleans expired journals", () => {
      const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-expired" });
      journal.writeUserMessage("old data");
      journal.close();

      // Set mtime to 8 days ago
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const journalPath = journal.getPath();
      fs.utimesSync(journalPath, oldTime / 1000, oldTime / 1000);

      const cleaned = SessionJournal.cleanExpired(tmpDir, 7 * 24 * 60 * 60 * 1000);
      expect(cleaned).toBe(1);
      expect(SessionJournal.exists("test-expired", tmpDir)).toBe(false);
    });
  });

  it("marks tool result errors", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "test-error" });
    journal.writeToolResult("c1", "Permission denied", true);
    journal.close();

    const entries = journal.readAll();
    expect(entries[0].data.isError).toBe(true);
  });

  it("readAll returns empty for missing file", () => {
    const journal = new SessionJournal({ rootDir: tmpDir, sessionId: "nonexistent" });
    expect(journal.readAll()).toEqual([]);
  });
});
