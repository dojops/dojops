export type { DocAugmenter, DocAugmenterOptions, DocProvider, LibraryInfo } from "./types";
export { Context7Client } from "./context7-client";
export { Context7DocAugmenter } from "./doc-augmenter";
export { TtlCache } from "./cache";
export { TOOL_LIBRARY_MAP, AGENT_LIBRARY_MAP, resolveLibraryQuery } from "./library-map";

import { Context7DocAugmenter } from "./doc-augmenter";
import { DocAugmenterOptions } from "./types";

/**
 * Factory function to create a documentation augmenter.
 * Reads configuration from options or environment variables.
 */
export function createDocAugmenter(options?: DocAugmenterOptions): Context7DocAugmenter {
  return new Context7DocAugmenter({
    apiKey: options?.apiKey ?? process.env.DOJOPS_CONTEXT7_API_KEY,
    baseUrl: options?.baseUrl,
    cacheTtlMs:
      options?.cacheTtlMs ??
      (process.env.DOJOPS_CONTEXT_CACHE_TTL
        ? Number.parseInt(process.env.DOJOPS_CONTEXT_CACHE_TTL, 10)
        : undefined),
    maxDocsLength:
      options?.maxDocsLength ??
      (process.env.DOJOPS_CONTEXT_MAX_LENGTH
        ? Number.parseInt(process.env.DOJOPS_CONTEXT_MAX_LENGTH, 10)
        : undefined),
    timeoutMs: options?.timeoutMs,
  });
}
