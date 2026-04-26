import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { hasFlag, extractFlagValue } from "../parser";
import { findProjectRoot, initProject } from "../state";
import {
  readTokenUsage,
  summarizeTokenUsage,
  estimateCacheSavings,
  TokenRecord,
  TokenSummary,
} from "../token-store";

export async function tokensCommand(args: string[], ctx: CLIContext): Promise<void> {
  const root = findProjectRoot() ?? ctx.cwd;
  if (!findProjectRoot()) initProject(root);

  const records = readTokenUsage(root);

  if (records.length === 0) {
    p.log.info("No token usage recorded yet. Use DojOps commands to start tracking.");
    return;
  }

  // Filter by --days
  const daysFlag = extractFlagValue(args, "--days");
  const days = daysFlag ? Number.parseInt(daysFlag, 10) : 0;
  const filtered = days > 0 ? filterByDays(records, days) : records;

  if (filtered.length === 0) {
    p.log.info(`No token usage in the last ${days} day(s).`);
    return;
  }

  const summary = summarizeTokenUsage(filtered);

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const showGraph = hasFlag(args, "--graph");
  const showByCommand = hasFlag(args, "--by-command");

  displayOverview(summary, days);
  displayByProvider(summary);

  if (showByCommand) {
    displayByCommand(summary);
  }

  if (showGraph) {
    displayDailyGraph(summary);
  }
}

function filterByDays(records: TokenRecord[], days: number): TokenRecord[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();
  return records.filter((r) => r.timestamp >= cutoffStr);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(cost: number): string {
  if (cost === 0) return pc.dim("$0.00");
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function displayOverview(summary: TokenSummary, days: number): void {
  const period = days > 0 ? `last ${days} day(s)` : "all time";
  const tokenBreakdown = pc.dim(
    `(${formatTokens(summary.totalPromptTokens)} in / ${formatTokens(summary.totalCompletionTokens)} out)`,
  );
  const lines = [
    `${pc.bold("Total tokens:")}  ${formatTokens(summary.totalTokens)}  ${tokenBreakdown}`,
    `${pc.bold("Total calls:")}   ${summary.totalCalls}`,
    `${pc.bold("Est. cost:")}     ${formatCost(summary.estimatedCost)}`,
  ];

  // Show cache stats when any cache activity has been recorded
  if (summary.totalCacheReadTokens > 0 || summary.totalCacheCreationTokens > 0) {
    // Aggregate savings across providers
    let totalSavings = 0;
    for (const [providerName, data] of Object.entries(summary.byProvider)) {
      totalSavings += estimateCacheSavings(providerName, data.cacheReadTokens);
    }
    const savingsLabel = `(saved ~${formatCost(totalSavings)})`;
    lines.push(
      `${pc.bold("Cache hits:")}    ${formatTokens(summary.totalCacheReadTokens)} tokens ${pc.green(savingsLabel)}`,
    );
    if (summary.totalCacheCreationTokens > 0) {
      lines.push(
        `${pc.bold("Cache writes:")}  ${formatTokens(summary.totalCacheCreationTokens)} tokens`,
      );
    }
  }

  p.note(lines.join("\n"), `Token Usage (${period})`);
}

function displayByProvider(summary: TokenSummary): void {
  const providers = Object.entries(summary.byProvider).sort((a, b) => b[1].tokens - a[1].tokens);
  if (providers.length === 0) return;

  const lines = providers.map(([name, data]) => {
    const pct = summary.totalTokens > 0 ? Math.round((data.tokens / summary.totalTokens) * 100) : 0;
    const callsLabel = pc.dim(`${data.calls} calls`);
    const pctLabel = pc.dim(`${pct}%`);
    return `  ${pc.cyan(name.padEnd(16))} ${formatTokens(data.tokens).padStart(8)}  ${callsLabel}  ${formatCost(data.cost).padStart(8)}  ${pctLabel}`;
  });

  p.note(lines.join("\n"), "By Provider");
}

function displayByCommand(summary: TokenSummary): void {
  const commands = Object.entries(summary.byCommand).sort((a, b) => b[1].tokens - a[1].tokens);
  if (commands.length === 0) return;

  const lines = commands.map(([name, data]) => {
    const callsLabel = pc.dim(`${data.calls} calls`);
    return `  ${pc.cyan(name.padEnd(16))} ${formatTokens(data.tokens).padStart(8)}  ${callsLabel}  ${formatCost(data.cost).padStart(8)}`;
  });

  p.note(lines.join("\n"), "By Command");
}

function displayDailyGraph(summary: TokenSummary): void {
  const days = Object.entries(summary.byDay).sort((a, b) => a[0].localeCompare(b[0]));
  if (days.length === 0) return;

  // Show last 14 days
  const recent = days.slice(-14);
  const maxTokens = Math.max(...recent.map(([, d]) => d.tokens));
  const barWidth = 40;

  const lines = recent.map(([date, data]) => {
    const ratio = maxTokens > 0 ? data.tokens / maxTokens : 0;
    const filled = Math.round(ratio * barWidth);
    const bar = pc.cyan("█".repeat(filled)) + pc.dim("░".repeat(barWidth - filled));
    return `  ${pc.dim(date.slice(5))}  ${bar}  ${formatTokens(data.tokens)}`;
  });

  p.note(lines.join("\n"), "Daily Usage (last 14 days)");
}
