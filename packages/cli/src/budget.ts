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

/** Check a single budget limit and return a warning if thresholds are crossed. */
function checkLimitWarning(
  label: string,
  spend: number,
  limit: number | undefined,
  percent: number,
): { message: string; exceeded: boolean } | null {
  if (!limit) return null;
  if (percent >= 100) {
    return {
      message: `${label} budget exceeded: $${spend.toFixed(4)} / $${limit}`,
      exceeded: true,
    };
  }
  if (percent >= 80) {
    return {
      message: `${label} budget at ${percent.toFixed(0)}%: $${spend.toFixed(4)} / $${limit}`,
      exceeded: false,
    };
  }
  return null;
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

  const dailyWarning = checkLimitWarning("Daily", dailySpend, budget.dailyLimitUsd, dailyPercent);
  if (dailyWarning) {
    warnings.push(dailyWarning.message);
    if (dailyWarning.exceeded) exceeded = true;
  }

  const monthlyWarning = checkLimitWarning(
    "Monthly",
    monthlySpend,
    budget.monthlyLimitUsd,
    monthlyPercent,
  );
  if (monthlyWarning) {
    warnings.push(monthlyWarning.message);
    if (monthlyWarning.exceeded) exceeded = true;
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
