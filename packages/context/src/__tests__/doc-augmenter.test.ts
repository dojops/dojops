import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Context7DocAugmenter } from "../doc-augmenter";
import { DocProvider } from "../types";

// Mock the Context7Client module so we can inject our own provider
vi.mock("../context7-client", () => ({
  Context7Client: vi.fn(),
}));

describe("Context7DocAugmenter", () => {
  let mockProvider: DocProvider;
  let augmenter: Context7DocAugmenter;

  beforeEach(() => {
    mockProvider = {
      resolveLibrary: vi.fn(),
      queryDocs: vi.fn(),
    };

    // Create augmenter and inject mock provider via property override
    augmenter = new Context7DocAugmenter({ cacheTtlMs: 60000 });
    // Override the private provider field for testing
    (augmenter as unknown as { provider: DocProvider }).provider = mockProvider;
  });

  afterEach(() => {
    augmenter.destroy();
  });

  it("augments system prompt with documentation", async () => {
    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "/hashicorp/terraform",
      name: "Terraform",
    });
    (mockProvider.queryDocs as ReturnType<typeof vi.fn>).mockResolvedValue(
      'resource block: resource "type" "name" { ... }',
    );

    const result = await augmenter.augmentPrompt(
      "You are a Terraform expert.",
      ["terraform"],
      "Create an S3 bucket",
    );

    expect(result).toContain("You are a Terraform expert.");
    expect(result).toContain("## Reference Documentation");
    expect(result).toContain("### terraform");
    expect(result).toContain("resource block:");
  });

  it("returns original prompt when no docs found", async () => {
    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const original = "You are a DevOps expert.";
    const result = await augmenter.augmentPrompt(original, ["unknown-tool"], "test query");

    expect(result).toBe(original);
  });

  it("handles multiple keywords", async () => {
    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: "/hashicorp/terraform", name: "Terraform" })
      .mockResolvedValueOnce({ id: "/kubernetes/kubernetes", name: "Kubernetes" });

    (mockProvider.queryDocs as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("terraform docs")
      .mockResolvedValueOnce("kubernetes docs");

    const result = await augmenter.augmentPrompt(
      "System prompt",
      ["terraform", "kubernetes"],
      "deploy infrastructure",
    );

    expect(result).toContain("### terraform");
    expect(result).toContain("terraform docs");
    expect(result).toContain("### kubernetes");
    expect(result).toContain("kubernetes docs");
  });

  it("truncates docs to maxDocsLength", async () => {
    augmenter.destroy();
    augmenter = new Context7DocAugmenter({ cacheTtlMs: 60000, maxDocsLength: 50 });
    (augmenter as unknown as { provider: DocProvider }).provider = mockProvider;

    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "/test/lib",
      name: "Test",
    });
    (mockProvider.queryDocs as ReturnType<typeof vi.fn>).mockResolvedValue("x".repeat(200));

    const result = await augmenter.augmentPrompt("System", ["test"], "query");

    // The docs section should be truncated
    const docsStart = result.indexOf("### test\n");
    const docsContent = result.slice(docsStart + "### test\n".length);
    expect(docsContent.length).toBeLessThanOrEqual(55); // 50 + "..." + newline
  });

  it("caches library resolution results", async () => {
    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "/test/lib",
      name: "Test",
    });
    (mockProvider.queryDocs as ReturnType<typeof vi.fn>).mockResolvedValue("docs");

    await augmenter.augmentPrompt("System", ["terraform"], "query 1");
    await augmenter.augmentPrompt("System", ["terraform"], "query 1");

    // resolveLibrary should only be called once due to caching
    expect(mockProvider.resolveLibrary).toHaveBeenCalledTimes(1);
  });

  it("skips keywords when library resolution returns null", async () => {
    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "/test/lib", name: "Test" });

    (mockProvider.queryDocs as ReturnType<typeof vi.fn>).mockResolvedValue("docs");

    const result = await augmenter.augmentPrompt("System", ["unknown", "known"], "query");

    expect(result).toContain("### known");
    expect(result).not.toContain("### unknown");
  });

  it("skips keywords when docs query returns empty", async () => {
    (mockProvider.resolveLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "/test/lib",
      name: "Test",
    });
    (mockProvider.queryDocs as ReturnType<typeof vi.fn>).mockResolvedValue("");

    const original = "System prompt";
    const result = await augmenter.augmentPrompt(original, ["test"], "query");

    expect(result).toBe(original);
  });
});
