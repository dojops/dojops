/**
 * Cost budget checking against daily/monthly limits.
 *
 * Reads token-usage.jsonl records from the .dojops directory and compares
 * estimated spend against configured budget thresholds.
 */

import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import { estimateCost } from "./token-store";

export interface BudgetStatus {
  dailySpendUsd: number;
  monthlySpendUsd: number;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  dailyPercent: number;
  monthlyPercent: number;
  exceeded: boolean;
  warnings: string[];
}

interface TokenRecord {
  timestamp: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
}

/** Load token usage records from the JSONL file. */
function loadTokenRecords(rootDir: string): TokenRecord[] {
  const filePath = path.join(rootDir, ".dojops", "token-usage.jsonl");
  if (!fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as TokenRecord);
  } catch {
    return [];
  }
}

/** Check current spend against budget limits. */
export function checkBudget(
  rootDir: string,
  budget?: { dailyLimitUsd?: number; monthlyLimitUsd?: number; action?: "warn" | "block" },
): BudgetStatus {
  if (!budget) {
    return {
      dailySpendUsd: 0,
      monthlySpendUsd: 0,
      dailyPercent: 0,
      monthlyPercent: 0,
      exceeded: false,
      warnings: [],
    };
  }

  const records = loadTokenRecords(rootDir);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  let dailySpend = 0;
  let monthlySpend = 0;

  for (const record of records) {
    const cost = estimateCost(record.provider, record.promptTokens, record.completionTokens);
    if (record.timestamp >= monthStart) {
      monthlySpend += cost;
    }
    if (record.timestamp >= todayStart) {
      dailySpend += cost;
    }
  }

  const dailyPercent = budget.dailyLimitUsd ? (dailySpend / budget.dailyLimitUsd) * 100 : 0;
  const monthlyPercent = budget.monthlyLimitUsd ? (monthlySpend / budget.monthlyLimitUsd) * 100 : 0;

  const warnings: string[] = [];
  let exceeded = false;

  if (budget.dailyLimitUsd) {
    if (dailyPercent >= 100) {
      warnings.push(`Daily budget exceeded: $${dailySpend.toFixed(4)} / $${budget.dailyLimitUsd}`);
      exceeded = true;
    } else if (dailyPercent >= 80) {
      warnings.push(
        `Daily budget at ${dailyPercent.toFixed(0)}%: $${dailySpend.toFixed(4)} / $${budget.dailyLimitUsd}`,
      );
    }
  }

  if (budget.monthlyLimitUsd) {
    if (monthlyPercent >= 100) {
      warnings.push(
        `Monthly budget exceeded: $${monthlySpend.toFixed(4)} / $${budget.monthlyLimitUsd}`,
      );
      exceeded = true;
    } else if (monthlyPercent >= 80) {
      warnings.push(
        `Monthly budget at ${monthlyPercent.toFixed(0)}%: $${monthlySpend.toFixed(4)} / $${budget.monthlyLimitUsd}`,
      );
    }
  }

  return {
    dailySpendUsd: dailySpend,
    monthlySpendUsd: monthlySpend,
    dailyLimitUsd: budget.dailyLimitUsd,
    monthlyLimitUsd: budget.monthlyLimitUsd,
    dailyPercent,
    monthlyPercent,
    exceeded,
    warnings,
  };
}

/** Print budget warnings to stderr. */
export function printBudgetWarnings(status: BudgetStatus): void {
  for (const warning of status.warnings) {
    if (status.exceeded) {
      console.warn(pc.red(`[budget] ${warning}`));
    } else {
      console.warn(pc.yellow(`[budget] ${warning}`));
    }
  }
}
