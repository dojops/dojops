import { DocAugmenter, DocAugmenterOptions, DocProvider } from "./types";
import { Context7Client } from "./context7-client";
import { TtlCache } from "./cache";
import { resolveLibraryQuery } from "./library-map";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_DOCS_LENGTH = 4000;

export class Context7DocAugmenter implements DocAugmenter {
  private provider: DocProvider;
  private libraryIdCache: TtlCache<string | null>;
  private docsCache: TtlCache<string>;
  private maxDocsLength: number;

  constructor(options?: DocAugmenterOptions) {
    this.provider = new Context7Client({
      apiKey: options?.apiKey,
      baseUrl: options?.baseUrl,
      timeoutMs: options?.timeoutMs,
    });
    const ttl = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.libraryIdCache = new TtlCache<string | null>(ttl);
    this.docsCache = new TtlCache<string>(ttl);
    this.maxDocsLength = options?.maxDocsLength ?? DEFAULT_MAX_DOCS_LENGTH;
  }

  async augmentPrompt(systemPrompt: string, keywords: string[], query: string): Promise<string> {
    const docSections: string[] = [];
    let totalLength = 0;

    for (const keyword of keywords) {
      if (totalLength >= this.maxDocsLength) break;

      const libraryQuery = resolveLibraryQuery(keyword);

      // Resolve library ID (cached)
      const cacheKey = `lib:${libraryQuery}`;
      let libraryId = this.libraryIdCache.get(cacheKey);

      if (libraryId === undefined) {
        const library = await this.provider.resolveLibrary(libraryQuery, query);
        libraryId = library?.id ?? null;
        this.libraryIdCache.set(cacheKey, libraryId);
      }

      if (!libraryId) continue;

      // Query docs (cached)
      const docsCacheKey = `docs:${libraryId}:${query.slice(0, 100)}`;
      let docs = this.docsCache.get(docsCacheKey);

      if (docs === undefined) {
        docs = await this.provider.queryDocs(libraryId, query);
        this.docsCache.set(docsCacheKey, docs);
      }

      if (!docs) continue;

      // Truncate if needed
      const remaining = this.maxDocsLength - totalLength;
      const truncated = docs.length > remaining ? docs.slice(0, remaining) + "\n..." : docs;

      docSections.push(`### ${keyword}\n${truncated}`);
      totalLength += truncated.length;
    }

    if (docSections.length === 0) return systemPrompt;

    const docsBlock = [
      "",
      "## Reference Documentation",
      "The following is current documentation for the technologies in this request.",
      "Use this as the authoritative reference for syntax and configuration patterns.",
      "",
      ...docSections,
    ].join("\n");

    return systemPrompt + "\n" + docsBlock;
  }

  destroy(): void {
    this.libraryIdCache.destroy();
    this.docsCache.destroy();
  }
}
