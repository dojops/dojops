import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  recordTokenUsage,
  readTokenUsage,
  summarizeTokenUsage,
  estimateCost,
  TokenRecord,
} from "../token-store";

describe("token-store", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-token-test-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("recordTokenUsage / readTokenUsage", () => {
    it("records and reads back token usage", () => {
      const record: TokenRecord = {
        timestamp: "2026-03-12T10:00:00.000Z",
        command: "generate",
        provider: "openai",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      recordTokenUsage(tmpDir, record);
      const records = readTokenUsage(tmpDir);

      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
    });

    it("appends multiple records", () => {
      recordTokenUsage(tmpDir, {
        timestamp: "2026-03-12T10:00:00.000Z",
        command: "generate",
        provider: "openai",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
      recordTokenUsage(tmpDir, {
        timestamp: "2026-03-12T11:00:00.000Z",
        command: "plan",
        provider: "anthropic",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
      });

      const records = readTokenUsage(tmpDir);
      expect(records).toHaveLength(2);
    });

    it("returns empty array when no file exists", () => {
      const records = readTokenUsage(tmpDir);
      expect(records).toEqual([]);
    });
  });

  describe("estimateCost", () => {
    it("estimates cost for openai", () => {
      const cost = estimateCost("openai", 1_000_000, 1_000_000);
      // 2.5 + 10 = 12.5
      expect(cost).toBe(12.5);
    });

    it("returns 0 for free providers", () => {
      expect(estimateCost("ollama", 1000, 1000)).toBe(0);
      expect(estimateCost("github-copilot", 1000, 1000)).toBe(0);
    });
  });

  describe("summarizeTokenUsage", () => {
    it("aggregates records correctly", () => {
      const records: TokenRecord[] = [
        {
          timestamp: "2026-03-11T10:00:00.000Z",
          command: "generate",
          provider: "openai",
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        {
          timestamp: "2026-03-12T10:00:00.000Z",
          command: "plan",
          provider: "openai",
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
        },
        {
          timestamp: "2026-03-12T11:00:00.000Z",
          command: "generate",
          provider: "anthropic",
          promptTokens: 150,
          completionTokens: 75,
          totalTokens: 225,
        },
      ];

      const summary = summarizeTokenUsage(records);

      expect(summary.totalTokens).toBe(675);
      expect(summary.totalCalls).toBe(3);
      expect(summary.totalPromptTokens).toBe(450);
      expect(summary.totalCompletionTokens).toBe(225);

      // By provider
      expect(summary.byProvider.openai.tokens).toBe(450);
      expect(summary.byProvider.openai.calls).toBe(2);
      expect(summary.byProvider.anthropic.tokens).toBe(225);
      expect(summary.byProvider.anthropic.calls).toBe(1);

      // By command
      expect(summary.byCommand.generate.tokens).toBe(375);
      expect(summary.byCommand.generate.calls).toBe(2);
      expect(summary.byCommand.plan.tokens).toBe(300);
      expect(summary.byCommand.plan.calls).toBe(1);

      // By day
      expect(summary.byDay["2026-03-11"].tokens).toBe(150);
      expect(summary.byDay["2026-03-12"].tokens).toBe(525);
    });

    it("handles empty records", () => {
      const summary = summarizeTokenUsage([]);
      expect(summary.totalTokens).toBe(0);
      expect(summary.totalCalls).toBe(0);
    });

    it("breaks down by actual subcommand names", () => {
      const records: TokenRecord[] = [
        {
          timestamp: "2026-03-12T10:00:00.000Z",
          command: "scan",
          provider: "openai",
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
        {
          timestamp: "2026-03-12T11:00:00.000Z",
          command: "arise",
          provider: "openai",
          promptTokens: 200,
          completionTokens: 100,
          totalTokens: 300,
        },
        {
          timestamp: "2026-03-12T12:00:00.000Z",
          command: "scan",
          provider: "anthropic",
          promptTokens: 50,
          completionTokens: 25,
          totalTokens: 75,
        },
        {
          timestamp: "2026-03-12T13:00:00.000Z",
          command: "chat",
          provider: "ollama",
          promptTokens: 300,
          completionTokens: 150,
          totalTokens: 450,
        },
      ];

      const summary = summarizeTokenUsage(records);

      expect(Object.keys(summary.byCommand)).toEqual(
        expect.arrayContaining(["scan", "arise", "chat"]),
      );
      expect(summary.byCommand.scan.calls).toBe(2);
      expect(summary.byCommand.scan.tokens).toBe(225);
      expect(summary.byCommand.arise.calls).toBe(1);
      expect(summary.byCommand.arise.tokens).toBe(300);
      expect(summary.byCommand.chat.calls).toBe(1);
      expect(summary.byCommand.chat.tokens).toBe(450);
      // "cli" should not appear when actual subcommand names are used
      expect(summary.byCommand.cli).toBeUndefined();
    });
  });
});
