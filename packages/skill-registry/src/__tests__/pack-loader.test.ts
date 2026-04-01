import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  parsePackManifest,
  discoverPacks,
  getPackSkillEntries,
  getPackAgentEntries,
} from "../pack-loader";
import type { InstalledPack, PackManifest } from "../pack-types";

let tmpDir: string;

function makePack(
  name: string,
  opts: {
    skills?: string[];
    agents?: string[];
    extra?: Record<string, unknown>;
  } = {},
): string {
  const packDir = path.join(tmpDir, "packs", name);
  fs.mkdirSync(packDir, { recursive: true });

  const manifest: PackManifest = {
    packVersion: "1",
    name,
    description: `Test pack: ${name}`,
    version: "1.0.0",
    skills: opts.skills ?? [],
    agents: opts.agents ?? [],
    ...opts.extra,
  };

  fs.writeFileSync(path.join(packDir, "pack.json"), JSON.stringify(manifest, null, 2));
  return packDir;
}

function writeDopsFile(packDir: string, relPath: string): void {
  const fullPath = path.join(packDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(
    fullPath,
    `---
meta:
  name: ${path.basename(relPath, ".dops")}
  version: "1.0.0"
  description: "Test skill"
  keywords: [test]
---

## Prompt

Generate a test file.
`,
  );
}

function writeAgentDir(packDir: string, agentName: string): void {
  const agentDir = path.join(packDir, "agents", agentName);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "README.md"),
    `# ${agentName}

## Domain
testing

## Description
A test agent.

## System Prompt
You are a test agent.

## Keywords
test, testing
`,
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parsePackManifest", () => {
  it("parses a valid pack.json", () => {
    const packDir = makePack("my-pack", { skills: ["skills/terraform.dops"] });
    const manifest = parsePackManifest(path.join(packDir, "pack.json"));
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe("my-pack");
    expect(manifest!.skills).toEqual(["skills/terraform.dops"]);
  });

  it("returns null for missing required fields", () => {
    const packDir = path.join(tmpDir, "bad-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(packDir, "pack.json"), JSON.stringify({ name: "bad" }));
    expect(parsePackManifest(path.join(packDir, "pack.json"))).toBeNull();
  });

  it("returns null for non-existent file", () => {
    expect(parsePackManifest("/no/such/file.json")).toBeNull();
  });

  it("defaults skills and agents to empty arrays", () => {
    const packDir = path.join(tmpDir, "minimal-pack");
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, "pack.json"),
      JSON.stringify({
        packVersion: "1",
        name: "minimal",
        description: "A minimal pack",
        version: "0.1.0",
      }),
    );
    const manifest = parsePackManifest(path.join(packDir, "pack.json"));
    expect(manifest).not.toBeNull();
    expect(manifest!.skills).toEqual([]);
    expect(manifest!.agents).toEqual([]);
  });
});

describe("discoverPacks", () => {
  it("discovers packs from a project directory", () => {
    const projectDir = path.join(tmpDir, "project");
    const packsDir = path.join(projectDir, ".dojops", "packs", "infra-pack");
    fs.mkdirSync(packsDir, { recursive: true });
    fs.writeFileSync(
      path.join(packsDir, "pack.json"),
      JSON.stringify({
        packVersion: "1",
        name: "infra-pack",
        description: "Infrastructure pack",
        version: "1.0.0",
        skills: [],
        agents: [],
      }),
    );

    const packs = discoverPacks(projectDir);
    expect(packs).toHaveLength(1);
    expect(packs[0].manifest.name).toBe("infra-pack");
    expect(packs[0].location).toBe("project");
  });

  it("returns empty array when no packs directory exists", () => {
    expect(discoverPacks("/nonexistent")).toEqual([]);
  });

  it("skips directories without pack.json", () => {
    const projectDir = path.join(tmpDir, "project2");
    const noPack = path.join(projectDir, ".dojops", "packs", "no-manifest");
    fs.mkdirSync(noPack, { recursive: true });
    fs.writeFileSync(path.join(noPack, "random.txt"), "not a pack");

    expect(discoverPacks(projectDir)).toEqual([]);
  });
});

describe("getPackSkillEntries", () => {
  it("extracts skill file entries from packs", () => {
    const packDir = makePack("terraform-pack", {
      skills: ["skills/terraform.dops", "skills/packer.dops"],
    });
    writeDopsFile(packDir, "skills/terraform.dops");
    writeDopsFile(packDir, "skills/packer.dops");

    const packs: InstalledPack[] = [
      {
        manifest: parsePackManifest(path.join(packDir, "pack.json"))!,
        packDir,
        location: "project",
      },
    ];

    const entries = getPackSkillEntries(packs);
    expect(entries).toHaveLength(2);
    expect(entries[0].filePath).toContain("terraform.dops");
    expect(entries[1].filePath).toContain("packer.dops");
  });

  it("skips missing skill files", () => {
    const packDir = makePack("missing-skills", { skills: ["skills/nonexistent.dops"] });
    const packs: InstalledPack[] = [
      {
        manifest: parsePackManifest(path.join(packDir, "pack.json"))!,
        packDir,
        location: "global",
      },
    ];

    expect(getPackSkillEntries(packs)).toEqual([]);
  });
});

describe("getPackAgentEntries", () => {
  it("extracts agent entries from packs", () => {
    const packDir = makePack("agent-pack", { agents: ["agents/terraform-agent"] });
    writeAgentDir(packDir, "terraform-agent");

    const packs: InstalledPack[] = [
      {
        manifest: parsePackManifest(path.join(packDir, "pack.json"))!,
        packDir,
        location: "project",
      },
    ];

    const entries = getPackAgentEntries(packs);
    expect(entries).toHaveLength(1);
    expect(entries[0].config.name).toBe("terraform-agent");
    expect(entries[0].config.domain).toBe("testing");
  });

  it("skips agents without README.md", () => {
    const packDir = makePack("bad-agents", { agents: ["agents/no-readme"] });
    const agentDir = path.join(packDir, "agents", "no-readme");
    fs.mkdirSync(agentDir, { recursive: true });
    // No README.md

    const packs: InstalledPack[] = [
      {
        manifest: parsePackManifest(path.join(packDir, "pack.json"))!,
        packDir,
        location: "global",
      },
    ];

    expect(getPackAgentEntries(packs)).toEqual([]);
  });
});
