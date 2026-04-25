import { describe, it, expect, vi } from "vitest";
import { RepoProfiler, RepoProfile, RepoProfileSchema } from "../../agents/repo-profiler";
import type { LLMProvider, LLMResponse } from "../../llm/provider";
import type { RepoContext } from "../../scanner/types";

function mockProvider(profile: RepoProfile): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: JSON.stringify(profile),
      parsed: profile,
    } satisfies LLMResponse),
  };
}

function mockProviderRaw(json: string): LLMProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: json,
    } satisfies LLMResponse),
  };
}

const nodeProfile: RepoProfile = {
  primaryLanguage: "typescript",
  packageManager: { name: "pnpm", lockfile: "pnpm-lock.yaml" },
  projectType: "webapp",
  buildTool: "turbo",
  testFramework: "vitest",
  frameworks: ["next", "react"],
  hasCI: true,
  hasDocker: true,
  hasInfra: false,
  isMonorepo: true,
  confidence: 0.92,
  rationale: "pnpm-workspace.yaml + turbo.json indicate a pnpm monorepo with Next.js",
};

const goProfile: RepoProfile = {
  primaryLanguage: "go",
  packageManager: { name: "go", lockfile: "go.sum" },
  projectType: "service",
  buildTool: "go",
  testFramework: "go test",
  frameworks: [],
  hasCI: false,
  hasDocker: false,
  hasInfra: false,
  isMonorepo: false,
  confidence: 0.85,
  rationale: "go.mod at root with cmd/server/ entrypoint",
};

const minimalCtx: RepoContext = {
  version: 2,
  scannedAt: new Date().toISOString(),
  rootPath: "/tmp/test",
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
  relevantDomains: [],
  devopsFiles: [],
} as RepoContext;

describe("RepoProfiler", () => {
  it("returns structured profile from parsed response", async () => {
    const provider = mockProvider(nodeProfile);
    const profiler = new RepoProfiler(provider);

    const result = await profiler.profile(minimalCtx, "package.json\npnpm-workspace.yaml\n");

    expect(result.primaryLanguage).toBe("typescript");
    expect(result.packageManager).toEqual({ name: "pnpm", lockfile: "pnpm-lock.yaml" });
    expect(result.projectType).toBe("webapp");
    expect(result.isMonorepo).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.frameworks).toContain("next");
  });

  it("falls back to parseAndValidate when response.parsed is undefined", async () => {
    const provider = mockProviderRaw(JSON.stringify(goProfile));
    const profiler = new RepoProfiler(provider);

    const result = await profiler.profile(minimalCtx, "go.mod\ngo.sum\ncmd/server/main.go\n");

    expect(result.primaryLanguage).toBe("go");
    expect(result.projectType).toBe("service");
    expect(result.isMonorepo).toBe(false);
  });

  it("passes system prompt and schema to provider", async () => {
    const provider = mockProvider(nodeProfile);
    const profiler = new RepoProfiler(provider);

    await profiler.profile(minimalCtx, "file.txt");

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.system).toContain("repository profiler");
    expect(call.schema).toBe(RepoProfileSchema);
    expect(call.prompt).toContain("Heuristic scan");
    expect(call.prompt).toContain("File listing");
  });

  it("includes heuristic context in prompt as wrapped data", async () => {
    const ctxWithLanguage = { ...minimalCtx, primaryLanguage: "python" as const };
    const provider = mockProvider(nodeProfile);
    const profiler = new RepoProfiler(provider);

    await profiler.profile(ctxWithLanguage, "requirements.txt\n");

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain('"primaryLanguage": "python"');
  });

  it("truncates file listing beyond MAX_INPUT_BYTES", async () => {
    const provider = mockProvider(nodeProfile);
    const profiler = new RepoProfiler(provider);
    const hugeListing = "x".repeat(200_000);

    await profiler.profile(minimalCtx, hugeListing);

    const call = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.prompt).toContain("[...truncated");
    expect(Buffer.byteLength(call.prompt)).toBeLessThan(200_000);
  });

  it("handles profile with all null optional fields", async () => {
    const nullProfile: RepoProfile = {
      primaryLanguage: null,
      packageManager: null,
      projectType: null,
      buildTool: null,
      testFramework: null,
      frameworks: [],
      hasCI: false,
      hasDocker: false,
      hasInfra: false,
      isMonorepo: false,
      confidence: 0.3,
      rationale: "Insufficient evidence to determine project type",
    };
    const provider = mockProvider(nullProfile);
    const profiler = new RepoProfiler(provider);

    const result = await profiler.profile(minimalCtx, "README.md\n");

    expect(result.primaryLanguage).toBeNull();
    expect(result.packageManager).toBeNull();
    expect(result.projectType).toBeNull();
    expect(result.confidence).toBe(0.3);
  });

  it("rejects invalid profile via schema validation", async () => {
    const invalid = { primaryLanguage: 42, confidence: 5 };
    const provider = mockProviderRaw(JSON.stringify(invalid));
    const profiler = new RepoProfiler(provider);

    await expect(profiler.profile(minimalCtx, "f.txt")).rejects.toThrow();
  });
});

describe("RepoProfileSchema", () => {
  it("validates a correct profile", () => {
    const result = RepoProfileSchema.safeParse(nodeProfile);
    expect(result.success).toBe(true);
  });

  it("rejects confidence > 1", () => {
    const result = RepoProfileSchema.safeParse({ ...nodeProfile, confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects confidence < 0", () => {
    const result = RepoProfileSchema.safeParse({ ...nodeProfile, confidence: -0.1 });
    expect(result.success).toBe(false);
  });

  it("accepts all valid projectType values", () => {
    for (const pt of [
      "library",
      "cli",
      "webapp",
      "service",
      "mobile",
      "infra",
      "monorepo",
      "unknown",
    ]) {
      const result = RepoProfileSchema.safeParse({ ...nodeProfile, projectType: pt });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown projectType", () => {
    const result = RepoProfileSchema.safeParse({ ...nodeProfile, projectType: "desktop" });
    expect(result.success).toBe(false);
  });

  it("requires rationale string", () => {
    const noRationale = Object.fromEntries(
      Object.entries(nodeProfile).filter(([k]) => k !== "rationale"),
    );
    const result = RepoProfileSchema.safeParse(noRationale);
    expect(result.success).toBe(false);
  });
});
