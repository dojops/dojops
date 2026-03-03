import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Context7Client } from "../context7-client";

describe("Context7Client", () => {
  let client: Context7Client;
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    client = new Context7Client({ baseUrl: "https://test.example.com/api/v2" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("resolveLibrary", () => {
    it("returns library info on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: "/hashicorp/terraform",
              name: "Terraform",
              description: "Infrastructure as code",
              totalSnippets: 150,
            },
          ]),
      });

      const result = await client.resolveLibrary("terraform", "create aws resources");

      expect(result).toEqual({
        id: "/hashicorp/terraform",
        name: "Terraform",
        description: "Infrastructure as code",
        snippetCount: 150,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/libs/search?"),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("returns null on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await client.resolveLibrary("unknown", "test");
      expect(result).toBeNull();
    });

    it("returns null on empty results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await client.resolveLibrary("nonexistent", "test");
      expect(result).toBeNull();
    });

    it("sends authorization header when API key is set", async () => {
      const authedClient = new Context7Client({
        baseUrl: "https://test.example.com/api/v2",
        apiKey: "test-key-123",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await authedClient.resolveLibrary("terraform", "test");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Authorization: "Bearer test-key-123" },
        }),
      );
    });
  });

  describe("queryDocs", () => {
    it("returns documentation text on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("# Terraform Configuration\nresource block syntax..."),
      });

      const result = await client.queryDocs("/hashicorp/terraform", "resource block syntax");
      expect(result).toBe("# Terraform Configuration\nresource block syntax...");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/context?"),
        expect.any(Object),
      );
    });

    it("returns empty string on HTTP error", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await client.queryDocs("/unknown/lib", "test");
      expect(result).toBe("");
    });

    it("requests text format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("docs"),
      });

      await client.queryDocs("/test/lib", "query");

      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const calledUrl = lastCall[0] as string;
      expect(calledUrl).toContain("type=txt");
    });
  });
});
