import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractSearchTerms,
  searchHub,
  promptHubInstall,
  installHubSkill,
  context7LlmFallback,
  suggestCustomSkill,
  warnNoSkill,
  trySkillFallback,
} from "../skill-fallback";
import type { CLIContext, GlobalOptions } from "../types";
import type { LLMProvider } from "@dojops/core";
import type { SearchPackage } from "../commands/skills";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// Mock skills.ts exports
vi.mock("../commands/skills", () => ({
  DEFAULT_HUB_URL: "https://hub.test",
  resolveLatestVersion: vi.fn(),
  downloadAndVerify: vi.fn(),
  parseDownloadedSkill: vi.fn(),
  resolveInstallDir: vi.fn(() => "/tmp/test-skills"),
}));

// Mock generate.ts exports used by skill-fallback
vi.mock("../commands/generate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../commands/generate")>();
  return {
    ...actual,
    outputFormatted: vi.fn(),
    handleWriteOutput: vi.fn(),
  };
});

// Mock fs
vi.mock("node:fs", async () => {
  const actual = await vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      ...(actual as Record<string, unknown>),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn(() => false),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
  };
});

function makeCtx(overrides: Partial<GlobalOptions> = {}): CLIContext {
  return {
    globalOpts: {
      output: "table" as const,
      raw: false,
      nonInteractive: false,
      verbose: false,
      debug: false,
      quiet: false,
      noColor: false,
      dryRun: false,
      ...overrides,
    },
    config: {},
    cwd: "/tmp",
    getProvider: vi.fn(),
  } as unknown as CLIContext;
}

function makeMockProvider() {
  return { generate: vi.fn(), listModels: vi.fn() } as unknown as LLMProvider & {
    generate: ReturnType<typeof vi.fn>;
  };
}

function makeSearchPackage(overrides: Partial<SearchPackage> = {}): SearchPackage {
  return {
    name: "test",
    slug: "test",
    description: "Test package",
    ...overrides,
  };
}

describe("extractSearchTerms", () => {
  it("strips action verbs and filler words", () => {
    const result = extractSearchTerms("Create a Redis cluster configuration");
    expect(result).toBe("redis cluster");
  });

  it("limits to 3 keywords", () => {
    const result = extractSearchTerms(
      "generate terraform aws s3 bucket cloudfront distribution lambda",
    );
    const words = result.split(" ");
    expect(words.length).toBeLessThanOrEqual(3);
  });

  it("returns trimmed prompt prefix if all words are stop words", () => {
    const result = extractSearchTerms("create a new");
    expect(result).toBe("create a new");
  });

  it("handles empty prompt", () => {
    const result = extractSearchTerms("");
    expect(result).toBe("");
  });

  it("strips punctuation", () => {
    const result = extractSearchTerms("Set up Nginx reverse-proxy!");
    expect(result).toBe("nginx reverse-proxy");
  });

  it("lowercases all terms", () => {
    const result = extractSearchTerms("Create Kubernetes Helm Chart");
    expect(result).toMatch(/kubernetes/);
    expect(result).toMatch(/helm/);
    expect(result).toMatch(/chart/);
  });
});

describe("searchHub", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns packages on successful response", async () => {
    const mockPackages = [makeSearchPackage({ name: "redis", slug: "redis" })];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ packages: mockPackages }),
    });

    const result = await searchHub("redis", "https://hub.test");
    expect(result).toEqual(mockPackages);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://hub.test/api/search?q=redis&limit=5",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns empty array on non-200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await searchHub("redis", "https://hub.test");
    expect(result).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await searchHub("redis", "https://hub.test");
    expect(result).toEqual([]);
  });

  it("returns empty array on timeout (abort)", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new DOMException("Aborted", "AbortError")), 10);
        }),
    );
    const result = await searchHub("redis", "https://hub.test");
    expect(result).toEqual([]);
  });
});

describe("promptHubInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty packages", async () => {
    const ctx = makeCtx();
    const result = await promptHubInstall(ctx, []);
    expect(result).toBeNull();
  });

  it("auto-selects first result in nonInteractive mode", async () => {
    const ctx = makeCtx({ nonInteractive: true });
    const packages = [makeSearchPackage({ name: "redis", slug: "redis", starCount: 5 })];
    const result = await promptHubInstall(ctx, packages);
    expect(result).toEqual(packages[0]);
  });

  it("returns null when user cancels select", async () => {
    const ctx = makeCtx();
    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const { select, isCancel } = await import("@clack/prompts");
    (select as ReturnType<typeof vi.fn>).mockResolvedValue("__skip__");
    (isCancel as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const packages = [makeSearchPackage({ name: "redis", slug: "redis" })];
    const result = await promptHubInstall(ctx, packages);
    expect(result).toBeNull();

    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });
});

describe("installHubSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true on successful install", async () => {
    const { resolveLatestVersion, downloadAndVerify, parseDownloadedSkill } =
      await import("../commands/skills");
    (resolveLatestVersion as ReturnType<typeof vi.fn>).mockResolvedValue("1.0.0");
    (downloadAndVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
      fileBuffer: Buffer.from("test"),
      actualHash: "abc",
      expectedHash: "abc",
    });
    (parseDownloadedSkill as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const result = await installHubSkill("redis", "redis");
    expect(result).toBe(true);
  });

  it("returns false on download failure", async () => {
    const { resolveLatestVersion } = await import("../commands/skills");
    (resolveLatestVersion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Not found"));

    const result = await installHubSkill("invalid", "invalid");
    expect(result).toBe(false);
  });
});

describe("context7LlmFallback", () => {
  it("returns generated content on success", async () => {
    const provider = makeMockProvider();
    provider.generate.mockResolvedValue({ content: "server { listen 80; }" });

    const result = await context7LlmFallback(
      "Create an Nginx config",
      provider,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe("server { listen 80; }");
  });

  it("augments prompt with docAugmenter when available", async () => {
    const provider = makeMockProvider();
    provider.generate.mockResolvedValue({ content: "result" });

    const docAugmenter = {
      augmentPrompt: vi.fn().mockResolvedValue("augmented system prompt"),
    };

    await context7LlmFallback(
      "Create an Nginx config",
      provider,
      docAugmenter,
      undefined,
      undefined,
    );

    expect(docAugmenter.augmentPrompt).toHaveBeenCalled();
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ system: "augmented system prompt" }),
    );
  });

  it("returns null on LLM failure", async () => {
    const provider = makeMockProvider();
    provider.generate.mockRejectedValue(new Error("API error"));

    const result = await context7LlmFallback(
      "Create something",
      provider,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBeNull();
  });

  it("returns null when content is empty", async () => {
    const provider = makeMockProvider();
    provider.generate.mockResolvedValue({ content: "" });

    const result = await context7LlmFallback(
      "Create something",
      provider,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBeNull();
  });

  it("includes project context in system prompt", async () => {
    const provider = makeMockProvider();
    provider.generate.mockResolvedValue({ content: "result" });

    await context7LlmFallback(
      "Create Redis config",
      provider,
      undefined,
      undefined,
      "Language: TypeScript; Has Dockerfile",
    );

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("Language: TypeScript; Has Dockerfile"),
      }),
    );
  });
});

describe("suggestCustomSkill", () => {
  it("does not throw", () => {
    expect(() => suggestCustomSkill("redis cluster")).not.toThrow();
  });
});

describe("warnNoSkill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays warning with skill name and creation suggestion", async () => {
    const { log } = await import("@clack/prompts");

    warnNoSkill("redis cluster");

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("redis-cluster"));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Unable to validate"));
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("dojops skills init"));
  });
});

describe("trySkillFallback", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 'skip' for analysis-intent prompts", async () => {
    const ctx = makeCtx();
    const provider = makeMockProvider();
    const result = await trySkillFallback(
      ctx,
      "What is wrong with my Dockerfile?",
      undefined,
      false,
      undefined,
      provider,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe("skip");
  });

  it("returns 'skip' and warns when hub is down and no Context7", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const ctx = makeCtx();
    const provider = makeMockProvider();
    const result = await trySkillFallback(
      ctx,
      "Create a Redis cluster config",
      undefined,
      false,
      undefined,
      provider,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe("skip");

    const { log } = await import("@clack/prompts");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Unable to validate"));
  });

  it("returns 'handled' when Context7+LLM generates content", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Hub down"));

    const provider = makeMockProvider();
    provider.generate.mockResolvedValue({ content: "generated content" });

    const docAugmenter = {
      augmentPrompt: vi.fn().mockImplementation((s: string) => Promise.resolve(s)),
    };

    const ctx = makeCtx({ output: "json" });
    const result = await trySkillFallback(
      ctx,
      "Create a Redis cluster config",
      undefined,
      false,
      undefined,
      provider,
      docAugmenter,
      undefined,
      undefined,
    );
    expect(result).toBe("handled");
  });

  it("returns 'retry' when hub skill is installed", async () => {
    const mockPackages = [
      makeSearchPackage({
        name: "redis",
        slug: "redis",
        description: "Redis config generator",
        latestVersion: { semver: "1.0.0" },
      }),
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ packages: mockPackages }),
    });

    const { resolveLatestVersion, downloadAndVerify, parseDownloadedSkill } =
      await import("../commands/skills");
    (resolveLatestVersion as ReturnType<typeof vi.fn>).mockResolvedValue("1.0.0");
    (downloadAndVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
      fileBuffer: Buffer.from("test"),
      actualHash: "abc",
      expectedHash: "abc",
    });
    (parseDownloadedSkill as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const ctx = makeCtx({ nonInteractive: true });
    const provider = makeMockProvider();
    const result = await trySkillFallback(
      ctx,
      "Create a Redis cluster config",
      undefined,
      false,
      undefined,
      provider,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe("retry");
  });

  it("falls through to Context7 when user skips hub install", async () => {
    const mockPackages = [makeSearchPackage({ name: "redis", slug: "redis" })];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ packages: mockPackages }),
    });

    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

    const { select } = await import("@clack/prompts");
    (select as ReturnType<typeof vi.fn>).mockResolvedValue("__skip__");

    const provider = makeMockProvider();
    provider.generate.mockResolvedValue({ content: "fallback content" });

    const docAugmenter = {
      augmentPrompt: vi.fn().mockImplementation((s: string) => Promise.resolve(s)),
    };

    const ctx = makeCtx({ output: "json" });
    const result = await trySkillFallback(
      ctx,
      "Create a Redis cluster config",
      undefined,
      false,
      undefined,
      provider,
      docAugmenter,
      undefined,
      undefined,
    );
    expect(result).toBe("handled");

    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });
});
