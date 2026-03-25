import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadManifest,
  saveManifest,
  recordInstall,
  getInstalledVersion,
  listInstalledSkills,
} from "../skill-manifest";

describe("skill-manifest", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-manifest-"));
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty manifest when file missing", () => {
    const manifest = loadManifest("project", tmpDir);
    expect(manifest.version).toBe(1);
    expect(manifest.skills).toEqual({});
  });

  it("round-trips save and load", () => {
    const manifest = { version: 1 as const, updatedAt: "2026-01-01", skills: {} };
    saveManifest(manifest, "project", tmpDir);
    const loaded = loadManifest("project", tmpDir);
    expect(loaded.version).toBe(1);
  });

  it("records and retrieves installed skill", () => {
    recordInstall(
      "project",
      {
        name: "terraform",
        version: "1.2.0",
        source: "hub",
        installedAt: new Date().toISOString(),
      },
      tmpDir,
    );

    expect(getInstalledVersion("terraform", "project", tmpDir)).toBe("1.2.0");
    expect(getInstalledVersion("nonexistent", "project", tmpDir)).toBeNull();
  });

  it("lists all installed skills", () => {
    recordInstall(
      "project",
      { name: "terraform", version: "1.0.0", source: "hub", installedAt: "2026-01-01" },
      tmpDir,
    );
    recordInstall(
      "project",
      { name: "kubernetes", version: "2.0.0", source: "hub", installedAt: "2026-01-01" },
      tmpDir,
    );
    const list = listInstalledSkills("project", tmpDir);
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.name).sort()).toEqual(["kubernetes", "terraform"]);
  });

  it("updates existing skill entry", () => {
    recordInstall(
      "project",
      { name: "terraform", version: "1.0.0", source: "hub", installedAt: "2026-01-01" },
      tmpDir,
    );
    recordInstall(
      "project",
      { name: "terraform", version: "1.1.0", source: "hub", installedAt: "2026-02-01" },
      tmpDir,
    );
    expect(getInstalledVersion("terraform", "project", tmpDir)).toBe("1.1.0");
    expect(listInstalledSkills("project", tmpDir)).toHaveLength(1);
  });
});
