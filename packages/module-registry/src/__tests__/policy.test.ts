import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "js-yaml";
import { loadModulePolicy, isModuleAllowed, ModulePolicy } from "../policy";

describe("loadModulePolicy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-policy-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty policy when no project path", () => {
    const policy = loadModulePolicy();
    expect(policy).toEqual({});
  });

  it("returns empty policy when policy file missing", () => {
    const policy = loadModulePolicy(tmpDir);
    expect(policy).toEqual({});
  });

  it("loads allowedModules from policy file", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ allowedModules: ["module-a", "module-b"] }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.allowedModules).toEqual(["module-a", "module-b"]);
  });

  it("loads blockedModules from policy file", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ blockedModules: ["bad-module"] }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.blockedModules).toEqual(["bad-module"]);
  });

  it("handles previous allowedTools field", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ allowedTools: ["legacy-a", "legacy-b"] }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.allowedModules).toEqual(["legacy-a", "legacy-b"]);
  });

  it("handles previous blockedTools field", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ blockedTools: ["legacy-bad"] }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.blockedModules).toEqual(["legacy-bad"]);
  });

  it("handles legacy allowedPlugins field", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ allowedPlugins: ["legacy-a", "legacy-b"] }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.allowedModules).toEqual(["legacy-a", "legacy-b"]);
  });

  it("handles legacy blockedPlugins field", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({ blockedPlugins: ["legacy-bad"] }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.blockedModules).toEqual(["legacy-bad"]);
  });

  it("prefers new field names over previous and legacy", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({
        allowedModules: ["new-field"],
        allowedTools: ["old-field"],
        allowedPlugins: ["legacy-field"],
      }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.allowedModules).toEqual(["new-field"]);
  });

  it("handles empty policy file", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(path.join(dojopsDir, "policy.yaml"), "", "utf-8");

    const policy = loadModulePolicy(tmpDir);
    expect(policy).toEqual({});
  });

  it("handles malformed policy file gracefully", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(path.join(dojopsDir, "policy.yaml"), "this is not: [valid yaml: {", "utf-8");

    const policy = loadModulePolicy(tmpDir);
    expect(policy).toEqual({});
  });

  it("filters non-string values from arrays", () => {
    const dojopsDir = path.join(tmpDir, ".dojops");
    fs.mkdirSync(dojopsDir, { recursive: true });
    fs.writeFileSync(
      path.join(dojopsDir, "policy.yaml"),
      yaml.dump({
        allowedModules: ["valid", 42, null, "also-valid"],
      }),
      "utf-8",
    );

    const policy = loadModulePolicy(tmpDir);
    expect(policy.allowedModules).toEqual(["valid", "also-valid"]);
  });
});

describe("isModuleAllowed", () => {
  it("allows everything with empty policy", () => {
    expect(isModuleAllowed("any-module", {})).toBe(true);
  });

  it("blocks modules in blockedModules list", () => {
    const policy: ModulePolicy = { blockedModules: ["bad-module", "evil-module"] };
    expect(isModuleAllowed("bad-module", policy)).toBe(false);
    expect(isModuleAllowed("evil-module", policy)).toBe(false);
    expect(isModuleAllowed("good-module", policy)).toBe(true);
  });

  it("only allows modules in allowedModules list", () => {
    const policy: ModulePolicy = { allowedModules: ["module-a", "module-b"] };
    expect(isModuleAllowed("module-a", policy)).toBe(true);
    expect(isModuleAllowed("module-b", policy)).toBe(true);
    expect(isModuleAllowed("module-c", policy)).toBe(false);
  });

  it("blockedModules takes precedence over allowedModules", () => {
    const policy: ModulePolicy = {
      allowedModules: ["module-a"],
      blockedModules: ["module-a"],
    };
    expect(isModuleAllowed("module-a", policy)).toBe(false);
  });

  it("allows everything when allowedModules is empty array", () => {
    const policy: ModulePolicy = { allowedModules: [] };
    expect(isModuleAllowed("any-module", policy)).toBe(true);
  });

  it("allows everything when blockedModules is empty array", () => {
    const policy: ModulePolicy = { blockedModules: [] };
    expect(isModuleAllowed("any-module", policy)).toBe(true);
  });

  describe("T-11: path traversal in module names", () => {
    it("blocks module name containing ../ when in blockedModules", () => {
      const policy: ModulePolicy = { blockedModules: ["../malicious-module"] };
      expect(isModuleAllowed("../malicious-module", policy)).toBe(false);
    });

    it("does not match traversal module name against legitimate module in allowedModules", () => {
      const policy: ModulePolicy = { allowedModules: ["my-module"] };
      // A module name with path traversal should not be in the allowed list
      expect(isModuleAllowed("../my-module", policy)).toBe(false);
      expect(isModuleAllowed("../../my-module", policy)).toBe(false);
    });

    it("module name with ../ is not allowed when only legitimate names are in allowedModules", () => {
      const policy: ModulePolicy = { allowedModules: ["module-a", "module-b"] };
      expect(isModuleAllowed("../module-a", policy)).toBe(false);
      expect(isModuleAllowed("module-a/../module-b", policy)).toBe(false);
    });

    it("module name with URL-encoded traversal is treated as a different name", () => {
      const policy: ModulePolicy = { allowedModules: ["module-a"] };
      // URL-encoded ../ (%2e%2e%2f) should not match the legitimate name
      expect(isModuleAllowed("%2e%2e%2fmodule-a", policy)).toBe(false);
      expect(isModuleAllowed("..%2fmodule-a", policy)).toBe(false);
    });

    it("blocks URL-encoded traversal names via blockedModules", () => {
      const policy: ModulePolicy = { blockedModules: ["%2e%2e%2fmalicious"] };
      expect(isModuleAllowed("%2e%2e%2fmalicious", policy)).toBe(false);
    });

    it("module name with backslash traversal is treated as a different name", () => {
      const policy: ModulePolicy = { allowedModules: ["module-a"] };
      expect(isModuleAllowed(String.raw`..\module-a`, policy)).toBe(false);
    });
  });
});
