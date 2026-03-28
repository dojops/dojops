import fs from "node:fs";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { extractFlagValue } from "../parser";
import { ExitCode, CLIError } from "../exit-codes";
import { findProjectRoot, readAudit } from "../state";
import type { AuditEntry } from "../state";

type ExportFormat = "json" | "csv" | "syslog";

function parseDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function filterByDateRange(entries: AuditEntry[], since?: string, until?: string): AuditEntry[] {
  let filtered = entries;

  if (since) {
    const sinceDate = parseDate(since);
    if (!sinceDate) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid --since date: "${since}"`);
    }
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= sinceDate.getTime());
  }

  if (until) {
    const untilDate = parseDate(until);
    if (!untilDate) {
      throw new CLIError(ExitCode.VALIDATION_ERROR, `Invalid --until date: "${until}"`);
    }
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= untilDate.getTime());
  }

  return filtered;
}

function exportAsJson(entries: AuditEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function exportAsCsv(entries: AuditEntry[]): string {
  const header = "timestamp,sequence,type,summary,hash,status,user,durationMs";
  const rows = entries.map((e) => {
    const planSuffix = e.planId ? ` (${e.planId})` : "";
    const summary = `${e.command}/${e.action}${planSuffix}`;
    return [
      escapeCSV(e.timestamp),
      e.seq ?? "",
      escapeCSV(e.command),
      escapeCSV(summary),
      e.hash ?? "",
      e.status,
      escapeCSV(e.user),
      e.durationMs,
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

/**
 * Format as RFC 5424 syslog message.
 * <priority>version timestamp hostname app-name procid msgid structured-data msg
 */
function exportAsSyslog(entries: AuditEntry[]): string {
  const hostname = process.env.HOSTNAME || "localhost";
  const appName = "dojops";

  return entries
    .map((e) => {
      // Severity mapping: success=6 (info), failure=3 (error), cancelled=4 (warning)
      let severity: number;
      if (e.status === "failure") {
        severity = 3;
      } else if (e.status === "cancelled") {
        severity = 4;
      } else {
        severity = 6;
      }
      // Facility 1 (user-level)
      const priority = 8 + severity;
      const ts = new Date(e.timestamp).toISOString();
      const planPart = e.planId ? ` planId=${e.planId}` : "";
      const hashPart = e.hash ? ` hash=${e.hash}` : "";
      const msg = `${e.command}/${e.action} status=${e.status} duration=${e.durationMs}ms${planPart}${hashPart}`;
      return `<${priority}>1 ${ts} ${hostname} ${appName} - - - ${msg}`;
    })
    .join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function auditExportCommand(args: string[], _ctx: CLIContext): Promise<void> {
  const root = findProjectRoot();
  if (!root) {
    p.log.info("No .dojops/ project found. Run `dojops init` first.");
    return;
  }

  const formatArg = extractFlagValue(args, "--format") ?? "json";
  const validFormats: ExportFormat[] = ["json", "csv", "syslog"];
  if (!validFormats.includes(formatArg as ExportFormat)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      `Invalid --format: "${formatArg}". Must be one of: ${validFormats.join(", ")}`,
    );
  }
  const format = formatArg as ExportFormat;

  const outputPath = extractFlagValue(args, "--output");
  const since = extractFlagValue(args, "--since");
  const until = extractFlagValue(args, "--until");

  // Read all audit entries
  const allEntries = readAudit(root);
  if (allEntries.length === 0) {
    p.log.info("No audit entries found.");
    return;
  }

  // Apply date filters
  const entries = filterByDateRange(allEntries, since, until);
  if (entries.length === 0) {
    p.log.info("No audit entries match the given date range.");
    return;
  }

  // Generate export
  let content: string;
  switch (format) {
    case "json":
      content = exportAsJson(entries);
      break;
    case "csv":
      content = exportAsCsv(entries);
      break;
    case "syslog":
      content = exportAsSyslog(entries);
      break;
  }

  // Output to file or stdout
  if (outputPath) {
    fs.writeFileSync(outputPath, content + "\n", "utf-8");
    p.log.success(`Exported ${entries.length} entries to ${pc.underline(outputPath)} (${format})`);
  } else {
    console.log(content);
  }
}
