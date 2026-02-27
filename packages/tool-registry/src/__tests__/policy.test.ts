import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yaml from "js-yaml";
import { loadToolPolicy, isToolAllowed, ToolPolicy } from "../policy";

describe("loadToolPolicy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-policy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty policy when no project path", () => {
    const policy = loadToolPolicy();
    expect(policy).toEqual({});
  });

  it("returns empty policy when policy file missing", () => {
    const policy = loadToolPolicy(tmpDir);
    expect(policy).toEqual({});
  });

  it("loads allowedTools from policy file", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ allowedTools: ["tool-a", "tool-b"] }),
      "utf-8",
    );

    const policy = loadToolPolicy(tmpDir);
    expect(policy.allowedTools).toEqual(["tool-a", "tool-b"]);
  });

  it("loads blockedTools from policy file", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ blockedTools: ["bad-tool"] }),
      "utf-8",
    );

    const policy = loadToolPolicy(tmpDir);
    expect(policy.blockedTools).toEqual(["bad-tool"]);
  });

  it("handles legacy allowedPlugins field", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ allowedPlugins: ["legacy-a", "legacy-b"] }),
      "utf-8",
    );

    const policy = loadToolPolicy(tmpDir);
    expect(policy.allowedTools).toEqual(["legacy-a", "legacy-b"]);
  });

  it("handles legacy blockedPlugins field", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ blockedPlugins: ["legacy-bad"] }),
      "utf-8",
    );

    const policy = loadToolPolicy(tmpDir);
    expect(policy.blockedTools).toEqual(["legacy-bad"]);
  });

  it("prefers new field names over legacy", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({
        allowedTools: ["new-field"],
        allowedPlugins: ["old-field"],
      }),
      "utf-8",
    );

    const policy = loadToolPolicy(tmpDir);
    expect(policy.allowedTools).toEqual(["new-field"]);
  });

  it("handles empty policy file", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(path.join(dojopsDir, "policy.yaml"), "", "utf-8");

    const policy = loadToolPolicy(tmpDir);
    expect(policy).toEqual({});
  });

  it("handles malformed policy file gracefully", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(path.join(dojopsDir, "policy.yaml"), "this is not: [valid yaml: {", "utf-8");

    const policy = loadToolPolicy(tmpDir);
    expect(policy).toEqual({});
  });

  it("filters non-string values from arrays", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({
        allowedTools: ["valid", 42, null, "also-valid"],
      }),
      "utf-8",
    );

    const policy = loadToolPolicy(tmpDir);
    expect(policy.allowedTools).toEqual(["valid", "also-valid"]);
  });
});

describe("isToolAllowed", () => {
  it("allows everything with empty policy", () => {
    expect(isToolAllowed("any-tool", {})).toBe(true);
  });

  it("blocks tools in blockedTools list", () => {
    const policy: ToolPolicy = { blockedTools: ["bad-tool", "evil-tool"] };
    expect(isToolAllowed("bad-tool", policy)).toBe(false);
    expect(isToolAllowed("evil-tool", policy)).toBe(false);
    expect(isToolAllowed("good-tool", policy)).toBe(true);
  });

  it("only allows tools in allowedTools list", () => {
    const policy: ToolPolicy = { allowedTools: ["tool-a", "tool-b"] };
    expect(isToolAllowed("tool-a", policy)).toBe(true);
    expect(isToolAllowed("tool-b", policy)).toBe(true);
    expect(isToolAllowed("tool-c", policy)).toBe(false);
  });

  it("blockedTools takes precedence over allowedTools", () => {
    const policy: ToolPolicy = {
      allowedTools: ["tool-a"],
      blockedTools: ["tool-a"],
    };
    expect(isToolAllowed("tool-a", policy)).toBe(false);
  });

  it("allows everything when allowedTools is empty array", () => {
    const policy: ToolPolicy = { allowedTools: [] };
    expect(isToolAllowed("any-tool", policy)).toBe(true);
  });

  it("allows everything when blockedTools is empty array", () => {
    const policy: ToolPolicy = { blockedTools: [] };
    expect(isToolAllowed("any-tool", policy)).toBe(true);
  });
});
