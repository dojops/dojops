import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { discoverProjectDirs, listSubDirs } from "./discovery";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-discovery-test-"));
}

describe("listSubDirs", () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns child directories", () => {
    fs.mkdirSync(path.join(root, "frontend"));
    fs.mkdirSync(path.join(root, "backend"));
    fs.writeFileSync(path.join(root, "README.md"), "");

    const dirs = listSubDirs(root);
    expect(dirs).toContain("frontend");
    expect(dirs).toContain("backend");
    expect(dirs).not.toContain("README.md");
  });

  it("skips dotfiles and noise directories", () => {
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.mkdirSync(path.join(root, "dist"));
    fs.mkdirSync(path.join(root, "real-project"));

    const dirs = listSubDirs(root);
    expect(dirs).toEqual(["real-project"]);
  });

  it("returns empty array for non-existent directory", () => {
    expect(listSubDirs("/nonexistent/path")).toEqual([]);
  });
});

describe("discoverProjectDirs", () => {
  let root: string;

  beforeEach(() => {
    root = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds indicator file at root level", () => {
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}");

    const dirs = discoverProjectDirs(root, ["package-lock.json"]);
    expect(dirs).toEqual([root]);
  });

  it("finds indicator files in child directories", () => {
    fs.mkdirSync(path.join(root, "backend"));
    fs.mkdirSync(path.join(root, "frontend"));
    fs.writeFileSync(path.join(root, "backend", "package-lock.json"), "{}");
    fs.writeFileSync(path.join(root, "frontend", "package-lock.json"), "{}");

    const dirs = discoverProjectDirs(root, ["package-lock.json"]);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(path.join(root, "backend"));
    expect(dirs).toContain(path.join(root, "frontend"));
  });

  it("finds indicator files in grandchild directories (packages/*/)", () => {
    fs.mkdirSync(path.join(root, "packages", "core"), { recursive: true });
    fs.mkdirSync(path.join(root, "packages", "api"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages", "core", "package-lock.json"), "{}");
    fs.writeFileSync(path.join(root, "packages", "api", "package-lock.json"), "{}");

    const dirs = discoverProjectDirs(root, ["package-lock.json"]);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(path.join(root, "packages", "core"));
    expect(dirs).toContain(path.join(root, "packages", "api"));
  });

  it("includes root and child directories when both have indicator", () => {
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(root, "sub", "package-lock.json"), "{}");

    const dirs = discoverProjectDirs(root, ["package-lock.json"]);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(root);
    expect(dirs).toContain(path.join(root, "sub"));
  });

  it("matches any of the provided indicator files", () => {
    fs.mkdirSync(path.join(root, "py-app"));
    fs.mkdirSync(path.join(root, "py-lib"));
    fs.writeFileSync(path.join(root, "py-app", "requirements.txt"), "");
    fs.writeFileSync(path.join(root, "py-lib", "pyproject.toml"), "");

    const dirs = discoverProjectDirs(root, [
      "requirements.txt",
      "Pipfile",
      "setup.py",
      "pyproject.toml",
    ]);
    expect(dirs).toHaveLength(2);
  });

  it("skips node_modules and dotfiles", () => {
    fs.mkdirSync(path.join(root, "node_modules", "lodash"), { recursive: true });
    fs.mkdirSync(path.join(root, ".cache", "project"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "lodash", "package-lock.json"), "{}");
    fs.writeFileSync(path.join(root, ".cache", "project", "package-lock.json"), "{}");

    const dirs = discoverProjectDirs(root, ["package-lock.json"]);
    expect(dirs).toHaveLength(0);
  });

  it("returns empty when no indicators found", () => {
    fs.mkdirSync(path.join(root, "empty-dir"));
    const dirs = discoverProjectDirs(root, ["package-lock.json"]);
    expect(dirs).toEqual([]);
  });
});
