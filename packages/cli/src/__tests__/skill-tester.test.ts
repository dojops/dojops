import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadFixtures, testOutputAgainstFixture } from "../skill-tester";

describe("skill-tester", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-test-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops", "skill-tests"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when no fixtures exist", () => {
    const fixtures = loadFixtures(tmpDir, "nonexistent");
    expect(fixtures).toEqual([]);
  });

  it("loads fixtures from JSON file", () => {
    const fixtures = [{ name: "basic", prompt: "Create a Dockerfile", expectedPatterns: ["FROM"] }];
    fs.writeFileSync(
      path.join(tmpDir, ".dojops", "skill-tests", "dockerfile.json"),
      JSON.stringify(fixtures),
    );
    const loaded = loadFixtures(tmpDir, "dockerfile");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("basic");
  });

  it("testOutputAgainstFixture passes when patterns match", () => {
    const result = testOutputAgainstFixture("FROM node:20-slim\nRUN npm install", {
      name: "basic",
      prompt: "test",
      expectedPatterns: ["FROM", String.raw`node:\d+`],
    });
    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("testOutputAgainstFixture fails when expected pattern missing", () => {
    const result = testOutputAgainstFixture("RUN npm install", {
      name: "basic",
      prompt: "test",
      expectedPatterns: ["FROM"],
    });
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("Expected pattern not found");
  });

  it("testOutputAgainstFixture fails when forbidden pattern found", () => {
    const result = testOutputAgainstFixture("FROM node:latest", {
      name: "no-latest",
      prompt: "test",
      forbiddenPatterns: ["latest"],
    });
    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain("Forbidden pattern found");
  });
});
