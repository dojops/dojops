import { DocProvider, LibraryInfo } from "./types";

const DEFAULT_BASE_URL = "https://context7.com/api/v2";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface Context7ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface SearchResult {
  id: string;
  name: string;
  description?: string;
  totalSnippets?: number;
  trustScore?: string;
}

export class Context7Client implements DocProvider {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options?: Context7ClientOptions) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options?.apiKey;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async resolveLibrary(name: string, query: string): Promise<LibraryInfo | null> {
    const params = new URLSearchParams({ libraryName: name, query });
    const url = `${this.baseUrl}/libs/search?${params}`;

    const response = await this.fetchWithTimeout(url);
    if (!response.ok) return null;

    const data = (await response.json()) as SearchResult[];
    if (!Array.isArray(data) || data.length === 0) return null;

    const best = data[0];
    return {
      id: best.id,
      name: best.name,
      description: best.description,
      snippetCount: best.totalSnippets,
    };
  }

  async queryDocs(libraryId: string, query: string): Promise<string> {
    const params = new URLSearchParams({ libraryId, query, type: "txt" });
    const url = `${this.baseUrl}/context?${params}`;

    const response = await this.fetchWithTimeout(url);
    if (!response.ok) return "";

    return response.text();
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      return await fetch(url, {
        signal: controller.signal,
        headers,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
