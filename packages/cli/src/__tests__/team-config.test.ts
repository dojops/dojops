import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadTeamConfig } from "../config";

describe("loadTeamConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-team-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when team.json missing", () => {
    const config = loadTeamConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("loads valid team config", () => {
    const teamConfig = { defaultProvider: "anthropic", defaultTemperature: 0.3 };
    fs.writeFileSync(path.join(tmpDir, ".dojops", "team.json"), JSON.stringify(teamConfig));
    const config = loadTeamConfig(tmpDir);
    expect(config.defaultProvider).toBe("anthropic");
    expect(config.defaultTemperature).toBe(0.3);
  });

  it("strips tokens from team config for security", () => {
    const teamConfig = { defaultProvider: "openai", tokens: { openai: "sk-secret" } };
    fs.writeFileSync(path.join(tmpDir, ".dojops", "team.json"), JSON.stringify(teamConfig));
    const config = loadTeamConfig(tmpDir);
    expect(config.tokens).toBeUndefined();
  });

  it("returns empty object for invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, ".dojops", "team.json"), "not json");
    const config = loadTeamConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("loads budget config from team.json", () => {
    const teamConfig = { budget: { dailyLimitUsd: 5, monthlyLimitUsd: 100, action: "block" } };
    fs.writeFileSync(path.join(tmpDir, ".dojops", "team.json"), JSON.stringify(teamConfig));
    const config = loadTeamConfig(tmpDir);
    expect(config.budget).toBeDefined();
    expect(config.budget?.dailyLimitUsd).toBe(5);
    expect(config.budget?.action).toBe("block");
  });

  it("warns and returns empty for invalid config fields", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const teamConfig = { defaultProvider: "invalid-provider" };
    fs.writeFileSync(path.join(tmpDir, ".dojops", "team.json"), JSON.stringify(teamConfig));
    const config = loadTeamConfig(tmpDir);
    // Invalid provider triggers Zod validation failure
    expect(config.defaultProvider).toBeUndefined();
    warnSpy.mockRestore();
  });
});
