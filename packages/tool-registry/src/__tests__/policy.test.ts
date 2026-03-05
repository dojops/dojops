import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

  describe("T-11: path traversal in tool names", () => {
    it("blocks tool name containing ../ when in blockedTools", () => {
      const policy: ToolPolicy = { blockedTools: ["../malicious-tool"] };
      expect(isToolAllowed("../malicious-tool", policy)).toBe(false);
    });

    it("does not match traversal tool name against legitimate tool in allowedTools", () => {
      const policy: ToolPolicy = { allowedTools: ["my-tool"] };
      // A tool name with path traversal should not be in the allowed list
      expect(isToolAllowed("../my-tool", policy)).toBe(false);
      expect(isToolAllowed("../../my-tool", policy)).toBe(false);
    });

    it("tool name with ../ is not allowed when only legitimate names are in allowedTools", () => {
      const policy: ToolPolicy = { allowedTools: ["tool-a", "tool-b"] };
      expect(isToolAllowed("../tool-a", policy)).toBe(false);
      expect(isToolAllowed("tool-a/../tool-b", policy)).toBe(false);
    });

    it("tool name with URL-encoded traversal is treated as a different name", () => {
      const policy: ToolPolicy = { allowedTools: ["tool-a"] };
      // URL-encoded ../ (%2e%2e%2f) should not match the legitimate name
      expect(isToolAllowed("%2e%2e%2ftool-a", policy)).toBe(false);
      expect(isToolAllowed("..%2ftool-a", policy)).toBe(false);
    });

    it("blocks URL-encoded traversal names via blockedTools", () => {
      const policy: ToolPolicy = { blockedTools: ["%2e%2e%2fmalicious"] };
      expect(isToolAllowed("%2e%2e%2fmalicious", policy)).toBe(false);
    });

    it("tool name with backslash traversal is treated as a different name", () => {
      const policy: ToolPolicy = { allowedTools: ["tool-a"] };
      expect(isToolAllowed("..\\tool-a", policy)).toBe(false);
    });
  });
});
