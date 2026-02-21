import pc from "picocolors";
import * as p from "@clack/prompts";
import { GlobalOptions } from "./types";

// ── Formatting helpers ─────────────────────────────────────────────

export function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return pc.green("*");
    case "failed":
      return pc.red("x");
    case "skipped":
      return pc.yellow("-");
    default:
      return pc.dim("?");
  }
}

export function statusText(status: string): string {
  switch (status) {
    case "completed":
      return pc.green(status);
    case "failed":
      return pc.red(status);
    case "skipped":
      return pc.yellow(status);
    default:
      return pc.dim(status);
  }
}

export function formatOutput(content: string): string {
  const lines = content.split("\n");
  const preview = lines.slice(0, 20);
  const formatted = preview.map((l) => `    ${pc.dim(l)}`).join("\n");
  if (lines.length > 20) {
    return `${formatted}\n    ${pc.dim(`... (${lines.length - 20} more lines)`)}`;
  }
  return formatted;
}

export function getOutputFileName(tool: string): string {
  switch (tool) {
    case "github-actions":
      return ".github/workflows/ci.yml";
    case "kubernetes":
      return "manifests.yml";
    case "ansible":
      return "playbook.yml";
    default:
      return "output.yml";
  }
}

export function formatConfidence(confidence: number): string {
  const pct = (confidence * 100).toFixed(0);
  if (confidence >= 0.8) return pc.green(`${pct}%`);
  if (confidence >= 0.5) return pc.yellow(`${pct}%`);
  return pc.red(`${pct}%`);
}

export function riskColor(level: string): string {
  switch (level) {
    case "low":
      return pc.green(level);
    case "medium":
      return pc.yellow(level);
    case "high":
    case "critical":
      return pc.red(level);
    default:
      return level;
  }
}

export function changeColor(action: string): string {
  switch (action) {
    case "CREATE":
      return pc.green(action);
    case "UPDATE":
    case "MODIFY":
      return pc.yellow(action);
    case "DELETE":
    case "DESTROY":
      return pc.red(action);
    default:
      return action;
  }
}

export function maskToken(token: string | undefined): string {
  if (!token) return pc.dim("(not set)");
  if (token.length <= 6) return "***";
  return token.slice(0, 3) + "***" + token.slice(-3);
}

// ── Session header ─────────────────────────────────────────────────

export function sessionHeader(ctx: { provider?: string; model?: string; mode?: string }): string {
  const parts: string[] = [];
  if (ctx.provider) parts.push(`${pc.bold("Provider:")} ${ctx.provider}`);
  if (ctx.model) parts.push(`${pc.bold("Model:")} ${ctx.model}`);
  if (ctx.mode) parts.push(`${pc.bold("Mode:")} ${ctx.mode}`);
  return parts.join("  ");
}

// ── Phase tracker ──────────────────────────────────────────────────

export function phaseIcon(phase: "done" | "running" | "awaiting" | "pending"): string {
  switch (phase) {
    case "done":
      return pc.green("✓");
    case "running":
      return pc.cyan("⟳");
    case "awaiting":
      return pc.yellow("⚠");
    case "pending":
      return pc.dim("○");
  }
}

// ── Output formatter factory ───────────────────────────────────────

export interface OutputFormatter {
  note(body: string, title?: string): void;
  success(msg: string): void;
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  step(msg: string): void;
  message(msg: string): void;
  json(data: unknown): void;
  table(headers: string[], rows: string[][]): void;
}

export function createFormatter(opts: GlobalOptions): OutputFormatter {
  if (opts.output === "json") {
    return createJsonFormatter(opts);
  }
  return createTableFormatter(opts);
}

function createTableFormatter(opts: GlobalOptions): OutputFormatter {
  return {
    note(body: string, title?: string) {
      if (opts.quiet) return;
      p.note(body, title);
    },
    success(msg: string) {
      if (opts.quiet) return;
      p.log.success(msg);
    },
    error(msg: string) {
      p.log.error(msg);
    },
    warn(msg: string) {
      if (opts.quiet) return;
      p.log.warn(msg);
    },
    info(msg: string) {
      if (opts.quiet) return;
      p.log.info(msg);
    },
    step(msg: string) {
      if (opts.quiet) return;
      p.log.step(msg);
    },
    message(msg: string) {
      p.log.message(msg);
    },
    json(data: unknown) {
      console.log(JSON.stringify(data, null, 2));
    },
    table(headers: string[], rows: string[][]) {
      if (opts.quiet) return;
      // Simple table: pad columns
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
      );
      const header = headers.map((h, i) => pc.bold(h.padEnd(widths[i]))).join("  ");
      const sep = widths.map((w) => pc.dim("-".repeat(w))).join("  ");
      const body = rows
        .map((row) => row.map((c, i) => (c ?? "").padEnd(widths[i])).join("  "))
        .join("\n");
      p.note(`${header}\n${sep}\n${body}`);
    },
  };
}

/* eslint-disable @typescript-eslint/no-unused-vars */
function createJsonFormatter(_opts: GlobalOptions): OutputFormatter {
  return {
    note(_body: string, _title?: string) {},
    success(_msg: string) {},
    error(msg: string) {
      console.error(JSON.stringify({ error: msg }));
    },
    warn(_msg: string) {},
    info(_msg: string) {},
    step(_msg: string) {},
    message(_msg: string) {},
    json(data: unknown) {
      console.log(JSON.stringify(data, null, 2));
    },
    table(_headers: string[], _rows: string[][]) {},
  };
}
/* eslint-enable @typescript-eslint/no-unused-vars */
