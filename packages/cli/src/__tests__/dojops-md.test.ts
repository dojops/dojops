import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadDojopsMd,
  writeDojopsMd,
  appendActivity,
  migrateLegacyContext,
  dojopsMdPath,
} from "../dojops-md";
import type { RepoContext } from "@dojops/core";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dojops-md-test-"));
}

function makeRepoContext(overrides?: Partial<RepoContext>): RepoContext {
  return {
    version: 2,
    scannedAt: "2026-03-08T10:00:00.000Z",
    rootPath: "/tmp/test",
    primaryLanguage: "node",
    languages: [{ name: "node", confidence: 0.9, indicator: "package.json" }],
    packageManager: null,
    ci: [{ platform: "github-actions", configPath: ".github/workflows/ci.yml" }],
    container: { hasDockerfile: true, hasCompose: false, hasSwarm: false },
    infra: {
      hasTerraform: false,
      tfProviders: [],
      hasState: false,
      hasKubernetes: false,
      hasHelm: false,
      hasAnsible: false,
      hasKustomize: false,
      hasVagrant: false,
      hasPulumi: false,
      hasCloudFormation: false,
    },
    monitoring: {
      hasPrometheus: false,
      hasNginx: false,
      hasSystemd: false,
      hasHaproxy: false,
      hasTomcat: false,
      hasApache: false,
      hasCaddy: false,
      hasEnvoy: false,
    },
    scripts: { shellScripts: [], pythonScripts: [], hasJustfile: false },
    security: {
      hasEnvExample: false,
      hasGitignore: true,
      hasCodeowners: false,
      hasSecurityPolicy: false,
      hasDependabot: false,
      hasRenovate: false,
      hasSecretScanning: false,
      hasEditorConfig: false,
    },
    meta: {
      isGitRepo: true,
      isMonorepo: false,
      hasMakefile: false,
      hasReadme: true,
      hasEnvFile: false,
    },
    relevantDomains: ["ci-cd"],
    devopsFiles: [".github/workflows/ci.yml", "Dockerfile"],
    ...overrides,
  } as RepoContext;
}

describe("writeDojopsMd + loadDojopsMd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips RepoContext through DOJOPS.md", () => {
    const ctx = makeRepoContext();
    writeDojopsMd(tmpDir, ctx);

    const loaded = loadDojopsMd(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.primaryLanguage).toBe("node");
    expect(loaded!.ci[0].platform).toBe("github-actions");
    expect(loaded!.container.hasDockerfile).toBe(true);
    expect(loaded!.devopsFiles).toEqual([".github/workflows/ci.yml", "Dockerfile"]);
  });

  it("creates DOJOPS.md with default body on first write", () => {
    writeDojopsMd(tmpDir, makeRepoContext());
    const content = fs.readFileSync(dojopsMdPath(tmpDir), "utf-8");
    expect(content).toContain("## Notes");
    expect(content).toContain("<!-- activity-start -->");
    expect(content).toContain("<!-- activity-end -->");
    expect(content).toContain("dojops: 1");
  });

  it("preserves body (Notes section) on re-write", () => {
    writeDojopsMd(tmpDir, makeRepoContext());

    // Simulate user editing the Notes section
    const filePath = dojopsMdPath(tmpDir);
    let content = fs.readFileSync(filePath, "utf-8");
    content = content.replace(
      "<!-- Add project-specific notes",
      "Always use pnpm.\n<!-- Add project-specific notes",
    );
    fs.writeFileSync(filePath, content);

    // Re-write with updated context
    writeDojopsMd(tmpDir, makeRepoContext({ primaryLanguage: "typescript" }));

    const updated = fs.readFileSync(filePath, "utf-8");
    expect(updated).toContain("Always use pnpm.");
    expect(updated).toContain("primaryLanguage: typescript");
  });

  it("returns null for non-existent file", () => {
    expect(loadDojopsMd(tmpDir)).toBeNull();
  });
});

describe("appendActivity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    writeDojopsMd(tmpDir, makeRepoContext());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends an activity entry", () => {
    appendActivity(tmpDir, "Generated ci.yml (github-actions)");

    const content = fs.readFileSync(dojopsMdPath(tmpDir), "utf-8");
    expect(content).toContain("Generated ci.yml (github-actions)");
  });

  it("prepends newest entry first", () => {
    appendActivity(tmpDir, "First action");
    appendActivity(tmpDir, "Second action");

    const content = fs.readFileSync(dojopsMdPath(tmpDir), "utf-8");
    const firstIdx = content.indexOf("First action");
    const secondIdx = content.indexOf("Second action");
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it("caps at 20 entries", () => {
    for (let i = 0; i < 25; i++) {
      appendActivity(tmpDir, `Action ${i}`);
    }

    const content = fs.readFileSync(dojopsMdPath(tmpDir), "utf-8");
    const entries = content.match(/^- \d{4}-/gm);
    expect(entries).not.toBeNull();
    expect(entries!.length).toBe(20);
    // Most recent should be present
    expect(content).toContain("Action 24");
    // Oldest should be trimmed
    expect(content).not.toContain("Action 4");
  });

  it("truncates long descriptions", () => {
    const longDesc = "A".repeat(300);
    appendActivity(tmpDir, longDesc);

    const content = fs.readFileSync(dojopsMdPath(tmpDir), "utf-8");
    expect(content).not.toContain("A".repeat(300));
    expect(content).toContain("\u2026"); // ellipsis
  });

  it("does nothing if DOJOPS.md doesn't exist", () => {
    const emptyDir = makeTmpDir();
    appendActivity(emptyDir, "Should not crash");
    expect(fs.existsSync(dojopsMdPath(emptyDir))).toBe(false);
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

describe("migrateLegacyContext", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, ".dojops"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrates context.json to DOJOPS.md", () => {
    const ctx = makeRepoContext();
    fs.writeFileSync(path.join(tmpDir, ".dojops", "context.json"), JSON.stringify(ctx, null, 2));
    fs.writeFileSync(path.join(tmpDir, ".dojops", "context.md"), "# Old markdown");

    const migrated = migrateLegacyContext(tmpDir);
    expect(migrated).toBe(true);

    // DOJOPS.md created
    expect(fs.existsSync(dojopsMdPath(tmpDir))).toBe(true);
    const loaded = loadDojopsMd(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.primaryLanguage).toBe("node");

    // Old files renamed to .bak
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "context.json.bak"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "context.md.bak"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".dojops", "context.json"))).toBe(false);
  });

  it("skips migration if DOJOPS.md already exists", () => {
    fs.writeFileSync(dojopsMdPath(tmpDir), "existing");
    fs.writeFileSync(
      path.join(tmpDir, ".dojops", "context.json"),
      JSON.stringify(makeRepoContext(), null, 2),
    );

    expect(migrateLegacyContext(tmpDir)).toBe(false);
  });

  it("skips migration if no context.json", () => {
    expect(migrateLegacyContext(tmpDir)).toBe(false);
  });
});
