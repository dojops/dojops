import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkBudget } from "../budget";

describe("checkBudget", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-budget-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns zero spend with no records", () => {
    const status = checkBudget(tmpDir, { dailyLimitUsd: 10 });
    expect(status.dailySpendUsd).toBe(0);
    expect(status.exceeded).toBe(false);
  });

  it("returns no warnings without budget config", () => {
    const status = checkBudget(tmpDir);
    expect(status.warnings).toEqual([]);
    expect(status.exceeded).toBe(false);
  });

  it("calculates daily spend from token records", () => {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      provider: "openai",
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    fs.writeFileSync(path.join(tmpDir, ".dojops", "token-usage.jsonl"), record + "\n");

    const status = checkBudget(tmpDir, { dailyLimitUsd: 10 });
    expect(status.dailySpendUsd).toBeGreaterThan(0);
  });

  it("warns at 80% threshold", () => {
    // Write enough records to exceed 80% of a tiny budget
    const records =
      Array.from({ length: 100 }, () =>
        JSON.stringify({
          timestamp: new Date().toISOString(),
          provider: "openai",
          promptTokens: 10000,
          completionTokens: 5000,
          totalTokens: 15000,
        }),
      ).join("\n") + "\n";
    fs.writeFileSync(path.join(tmpDir, ".dojops", "token-usage.jsonl"), records);

    const status = checkBudget(tmpDir, { dailyLimitUsd: 0.001 });
    expect(status.exceeded).toBe(true);
    expect(status.warnings.length).toBeGreaterThan(0);
  });

  it("does not warn when under 80% threshold", () => {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      provider: "openai",
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    fs.writeFileSync(path.join(tmpDir, ".dojops", "token-usage.jsonl"), record + "\n");

    const status = checkBudget(tmpDir, { dailyLimitUsd: 1000 });
    expect(status.exceeded).toBe(false);
    expect(status.warnings).toEqual([]);
  });

  it("checks monthly spend separately from daily", () => {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      provider: "openai",
      promptTokens: 10000,
      completionTokens: 5000,
      totalTokens: 15000,
    });
    fs.writeFileSync(path.join(tmpDir, ".dojops", "token-usage.jsonl"), record + "\n");

    const status = checkBudget(tmpDir, { monthlyLimitUsd: 0.0001 });
    expect(status.exceeded).toBe(true);
    expect(status.warnings.some((w) => w.includes("Monthly"))).toBe(true);
  });

  it("handles missing token-usage.jsonl gracefully", () => {
    // No file created — .dojops dir exists but no jsonl
    const status = checkBudget(tmpDir, { dailyLimitUsd: 10, monthlyLimitUsd: 100 });
    expect(status.dailySpendUsd).toBe(0);
    expect(status.monthlySpendUsd).toBe(0);
    expect(status.exceeded).toBe(false);
  });

  it("handles malformed JSONL lines gracefully", () => {
    fs.writeFileSync(path.join(tmpDir, ".dojops", "token-usage.jsonl"), "not json\n{bad\n");
    const status = checkBudget(tmpDir, { dailyLimitUsd: 10 });
    expect(status.dailySpendUsd).toBe(0);
  });
});
