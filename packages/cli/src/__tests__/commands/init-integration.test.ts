import { describe, it, expect, vi } from "vitest";
import type { RepoContext } from "@dojops/core";

// ── Mocks ────────────────────────────────────────────────────────────

const mockSpinner = { start: vi.fn(), stop: vi.fn() };
vi.mock("@clack/prompts", () => ({
  log: { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  note: vi.fn(),
  spinner: vi.fn(() => mockSpinner),
  intro: vi.fn(),
  outro: vi.fn(),
  isCancel: vi.fn(() => false),
  confirm: vi.fn().mockResolvedValue(true),
  text: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@dojops/core", async () => {
  const actual = await vi.importActual<typeof import("@dojops/core")>("@dojops/core");
  return {
    ...actual,
    scanRepo: vi.fn(),
    enrichWithLLM: vi.fn(),
    RepoProfiler: vi.fn(),
    generateDirectoryTree: vi.fn(() => ".\n├── src/\n└── package.json"),
    readKeyFiles: vi.fn(() => null),
  };
});

vi.mock("@dojops/sdk", () => ({
  runBin: vi.fn(),
}));

vi.mock("../../state", () => ({
  initProject: vi.fn(),
  findProjectRoot: vi.fn(() => "/tmp/test-project"),
}));

vi.mock("../../preflight", () => ({
  offerToolInstall: vi.fn(),
  offerSystemToolInstall: vi.fn(),
}));

vi.mock("../../parser", () => ({
  hasFlag: vi.fn(() => false),
}));

vi.mock("../../formatter", () => ({
  truncateNoteTitle: vi.fn((s: string) => s),
  wrapForNote: vi.fn((s: string) => s),
}));

vi.mock("../../dojops-md", () => ({
  writeDojopsMd: vi.fn(),
  dojopsMdPath: vi.fn(() => "/tmp/test-project/.dojops/dojops.md"),
  migrateLegacyContext: vi.fn(),
}));

vi.mock("../../memory", () => ({
  recordTask: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
  },
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
}));

import { formatScanSummary, formatContextMarkdown } from "../../commands/init";

// ── Test fixture ─────────────────────────────────────────────────────

function makeRepoCtx(overrides: Partial<RepoContext> = {}): RepoContext {
  return {
    version: 2,
    scannedAt: "2026-04-25T10:00:00.000Z",
    rootPath: "/tmp/test-project",
    languages: [{ name: "typescript", confidence: 0.95, indicator: "tsconfig.json" }],
    primaryLanguage: "typescript",
    packageManager: { name: "pnpm", lockfile: "pnpm-lock.yaml" },
    ci: [{ platform: "GitHub Actions", configPath: ".github/workflows/ci.yml" }],
    container: { hasDockerfile: true, hasCompose: true, composePath: "docker-compose.yml" },
    infra: {
      hasTerraform: true,
      tfProviders: ["aws", "kubernetes"],
      hasState: true,
      hasKubernetes: true,
      hasHelm: false,
      hasAnsible: false,
      hasKustomize: false,
      hasVagrant: false,
      hasPulumi: false,
      hasCloudFormation: false,
    },
    monitoring: {
      hasPrometheus: true,
      hasNginx: false,
      hasSystemd: false,
      hasHaproxy: false,
      hasTomcat: false,
      hasApache: false,
      hasCaddy: false,
      hasEnvoy: false,
    },
    scripts: { shellScripts: ["deploy.sh"], pythonScripts: [], hasJustfile: false },
    security: {
      hasEnvExample: true,
      hasGitignore: true,
      hasCodeowners: true,
      hasSecurityPolicy: false,
      hasDependabot: true,
      hasRenovate: false,
      hasSecretScanning: false,
      hasEditorConfig: true,
    },
    meta: {
      isGitRepo: true,
      isMonorepo: true,
      hasMakefile: true,
      hasReadme: true,
      hasEnvFile: false,
    },
    relevantDomains: ["infrastructure", "ci-cd"],
    devopsFiles: [".github/workflows/ci.yml", "terraform/main.tf", "Dockerfile"],
    ...overrides,
  } as RepoContext;
}

// ── formatScanSummary tests ──────────────────────────────────────────

describe("formatScanSummary", () => {
  it("includes language, package manager, and CI platform", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("typescript");
    expect(joined).toContain("pnpm");
    expect(joined).toContain("GitHub Actions");
  });

  it("includes infrastructure signals", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("Terraform");
    expect(joined).toContain("aws");
    expect(joined).toContain("Kubernetes");
  });

  it("includes container signals", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("Dockerfile");
    expect(joined).toContain("Compose");
  });

  it("includes monitoring signals", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("Prometheus");
  });

  it("includes scripts", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("1 shell");
  });

  it("includes security elements", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain(".gitignore");
    expect(joined).toContain("Dependabot");
    expect(joined).toContain("CODEOWNERS");
  });

  it("includes meta signals", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("monorepo");
    expect(joined).toContain("Makefile");
  });

  it("includes agent domains", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("infrastructure");
    expect(joined).toContain("ci-cd");
  });

  it("includes devopsFiles count", () => {
    const lines = formatScanSummary(makeRepoCtx());
    const joined = lines.join("\n");
    expect(joined).toContain("3 detected");
  });

  it("handles bare-minimum context without crashing", () => {
    const bare = makeRepoCtx({
      languages: [],
      primaryLanguage: null,
      packageManager: null,
      ci: [],
      container: { hasDockerfile: false, hasCompose: false },
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
        hasGitignore: false,
        hasCodeowners: false,
        hasSecurityPolicy: false,
        hasDependabot: false,
        hasRenovate: false,
        hasSecretScanning: false,
        hasEditorConfig: false,
      },
      meta: {
        isGitRepo: false,
        isMonorepo: false,
        hasMakefile: false,
        hasReadme: false,
        hasEnvFile: false,
      },
      relevantDomains: [],
      devopsFiles: [],
    });
    const lines = formatScanSummary(bare);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join("\n")).toContain("none detected");
  });
});

// ── formatContextMarkdown tests ──────────────────────────────────────

describe("formatContextMarkdown", () => {
  it("produces valid markdown with all sections", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain("# Project Context");
    expect(md).toContain("## Languages");
    expect(md).toContain("## Package Manager");
    expect(md).toContain("## CI/CD");
    expect(md).toContain("## Container");
    expect(md).toContain("## Infrastructure");
    expect(md).toContain("## Monitoring");
    expect(md).toContain("## Scripts");
    expect(md).toContain("## Security");
    expect(md).toContain("## Metadata");
    expect(md).toContain("## DevOps Files");
    expect(md).toContain("## Additional Context");
  });

  it("includes Terraform providers in infrastructure section", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain("aws");
    expect(md).toContain("kubernetes");
    expect(md).toContain("has state");
  });

  it("includes primary language", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain("typescript");
    expect(md).toContain("Primary language: **typescript**");
  });

  it("lists CI config paths", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain(".github/workflows/ci.yml");
    expect(md).toContain("GitHub Actions");
  });

  it("includes compose path in container section", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain("docker-compose.yml");
  });

  it("lists devops files as code blocks", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain("`terraform/main.tf`");
    expect(md).toContain("`Dockerfile`");
  });

  it("adds preservation comment in Additional Context", () => {
    const md = formatContextMarkdown(makeRepoCtx());
    expect(md).toContain("preserved across re-runs");
  });

  it("shows 'no languages detected' for empty context", () => {
    const md = formatContextMarkdown(makeRepoCtx({ languages: [], primaryLanguage: null }));
    expect(md).toContain("No languages detected");
  });

  it("shows 'no CI/CD' for empty CI array", () => {
    const md = formatContextMarkdown(makeRepoCtx({ ci: [] }));
    expect(md).toContain("No CI/CD configurations detected");
  });
});
