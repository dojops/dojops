export interface LibraryInfo {
  id: string;
  name: string;
  description?: string;
  snippetCount?: number;
}

export interface DocProvider {
  resolveLibrary(name: string, query: string): Promise<LibraryInfo | null>;
  queryDocs(libraryId: string, query: string): Promise<string>;
}

export interface DocAugmenter {
  augmentPrompt(systemPrompt: string, keywords: string[], query: string): Promise<string>;
}

export interface DocAugmenterOptions {
  apiKey?: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  maxDocsLength?: number;
  timeoutMs?: number;
}
