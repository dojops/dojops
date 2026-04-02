/**
 * File-based token usage persistence.
 *
 * Appends per-call records to `.dojops/token-usage.jsonl`.
 * Read by the `dojops tokens` command for analytics.
 */

import fs from "node:fs";
import path from "node:path";
import { dojopsDir } from "./state";

export interface TokenRecord {
  timestamp: string;
  command: string;
  provider: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

function tokenFilePath(rootDir: string): string {
  return path.join(dojopsDir(rootDir), "token-usage.jsonl");
}

/** Append a token usage record to the JSONL store. */
export function recordTokenUsage(rootDir: string, record: TokenRecord): void {
  try {
    const filePath = tokenFilePath(rootDir);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
  } catch {
    // Non-fatal — don't break the user's workflow
  }
}

/** Read all token usage records. */
export function readTokenUsage(rootDir: string): TokenRecord[] {
  const filePath = tokenFilePath(rootDir);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf-8").trim();
  if (!content) return [];

  const records: TokenRecord[] = [];
  for (const line of content.split("\n")) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return records;
}

/** Per-provider cost estimates ($ per 1M tokens) — rough averages for input+output. */
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  openai: { input: 2.5, output: 10 },
  anthropic: { input: 3, output: 15 },
  deepseek: { input: 0.14, output: 0.28 },
  gemini: { input: 1.25, output: 5 },
  "github-copilot": { input: 0, output: 0 },
  ollama: { input: 0, output: 0 },
};

export function estimateCost(
  provider: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rates = COST_PER_MILLION[provider] ?? { input: 2.5, output: 10 };
  return (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000;
}

/** Estimate cost savings from prompt cache reads (cache reads cost ~10% of input, saving 90%). */
export function estimateCacheSavings(provider: string, cacheReadTokens: number): number {
  const rates = COST_PER_MILLION[provider] ?? { input: 2.5, output: 10 };
  return (cacheReadTokens * rates.input * 0.9) / 1_000_000;
}

export interface TokenSummary {
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCalls: number;
  estimatedCost: number;
  byProvider: Record<
    string,
    {
      tokens: number;
      promptTokens: number;
      completionTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
      calls: number;
      cost: number;
    }
  >;
  byCommand: Record<string, { tokens: number; calls: number; cost: number }>;
  byDay: Record<string, { tokens: number; calls: number; cost: number }>;
}

/** Aggregate token records into a summary. */
export function summarizeTokenUsage(records: TokenRecord[]): TokenSummary {
  const summary: TokenSummary = {
    totalTokens: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCalls: records.length,
    estimatedCost: 0,
    byProvider: {},
    byCommand: {},
    byDay: {},
  };

  for (const r of records) {
    const cost = estimateCost(r.provider, r.promptTokens, r.completionTokens);

    summary.totalTokens += r.totalTokens;
    summary.totalPromptTokens += r.promptTokens;
    summary.totalCompletionTokens += r.completionTokens;
    summary.totalCacheCreationTokens += r.cacheCreationTokens ?? 0;
    summary.totalCacheReadTokens += r.cacheReadTokens ?? 0;
    summary.estimatedCost += cost;

    // By provider
    if (!summary.byProvider[r.provider]) {
      summary.byProvider[r.provider] = {
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        calls: 0,
        cost: 0,
      };
    }
    const bp = summary.byProvider[r.provider];
    bp.tokens += r.totalTokens;
    bp.promptTokens += r.promptTokens;
    bp.completionTokens += r.completionTokens;
    bp.cacheCreationTokens += r.cacheCreationTokens ?? 0;
    bp.cacheReadTokens += r.cacheReadTokens ?? 0;
    bp.calls++;
    bp.cost += cost;

    // By command
    if (!summary.byCommand[r.command]) {
      summary.byCommand[r.command] = { tokens: 0, calls: 0, cost: 0 };
    }
    const bc = summary.byCommand[r.command];
    bc.tokens += r.totalTokens;
    bc.calls++;
    bc.cost += cost;

    // By day
    const day = r.timestamp.slice(0, 10);
    if (!summary.byDay[day]) {
      summary.byDay[day] = { tokens: 0, calls: 0, cost: 0 };
    }
    const bd = summary.byDay[day];
    bd.tokens += r.totalTokens;
    bd.calls++;
    bd.cost += cost;
  }

  return summary;
}
