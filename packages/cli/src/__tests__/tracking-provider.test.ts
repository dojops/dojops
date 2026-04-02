import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { LLMProvider, LLMResponse } from "@dojops/core";
import { TrackingProvider, withTracking } from "../tracking-provider";
import { readTokenUsage } from "../token-store";

// Stub budget and config so TrackingProvider doesn't hit real files
vi.mock("../budget", () => ({
  checkBudget: vi.fn(() => ({ warnings: [], exceeded: false })),
  printBudgetWarnings: vi.fn(),
}));

vi.mock("../config", () => ({
  loadConfig: vi.fn(() => ({})),
}));

function makeFakeProvider(usage?: LLMResponse["usage"]): LLMProvider {
  return {
    name: "fake",
    async generate(): Promise<LLMResponse> {
      return {
        text: "hello",
        usage: usage ?? {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };
    },
  };
}

describe("TrackingProvider", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-tracking-test-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records the command name passed at construction", async () => {
    const inner = makeFakeProvider();
    const provider = new TrackingProvider(inner, tmpDir, "scan");

    await provider.generate({ messages: [{ role: "user", content: "test" }] });

    const records = readTokenUsage(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].command).toBe("scan");
    expect(records[0].provider).toBe("fake");
  });

  it("records different command names for different instances", async () => {
    const inner = makeFakeProvider();

    const providerA = new TrackingProvider(inner, tmpDir, "plan");
    const providerB = new TrackingProvider(inner, tmpDir, "arise");

    await providerA.generate({ messages: [{ role: "user", content: "a" }] });
    await providerB.generate({ messages: [{ role: "user", content: "b" }] });

    const records = readTokenUsage(tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0].command).toBe("plan");
    expect(records[1].command).toBe("arise");
  });

  it("does not record when there is no usage data", async () => {
    const inner: LLMProvider = {
      name: "no-usage",
      async generate(): Promise<LLMResponse> {
        return { text: "ok" };
      },
    };

    const provider = new TrackingProvider(inner, tmpDir, "generate");
    await provider.generate({ messages: [{ role: "user", content: "test" }] });

    const records = readTokenUsage(tmpDir);
    expect(records).toHaveLength(0);
  });
});

describe("withTracking", () => {
  it("returns original provider when rootDir is null", () => {
    const inner = makeFakeProvider();
    const result = withTracking(inner, null, "generate");
    expect(result).toBe(inner);
  });

  it("returns a TrackingProvider when rootDir is provided", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-wt-test-"));
    try {
      const inner = makeFakeProvider();
      const result = withTracking(inner, tmpDir, "chat");
      expect(result).toBeInstanceOf(TrackingProvider);
      expect(result).not.toBe(inner);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
