/**
 * Rich terminal status bar for the TUI chat.
 *
 * Renders a persistent header showing session info, agent, model, token count.
 * Uses raw ANSI escape codes — zero new dependencies.
 */
import pc from "picocolors";

export interface StatusBarState {
  sessionId: string;
  sessionName?: string;
  agent: string;
  model: string;
  provider: string;
  tokenEstimate: number;
  messageCount: number;
  mode: string;
  streaming: boolean;
}

const DIVIDER_CHAR = "─";

/** Build a single-line status bar string (no newlines). */
export function renderStatusBar(state: StatusBarState): string {
  const sessionLabel = state.sessionName
    ? `${pc.cyan(state.sessionName)} ${pc.dim(`(${state.sessionId.slice(0, 8)})`)}`
    : pc.cyan(state.sessionId.slice(0, 12));

  const agentLabel = state.agent === "auto-route" ? pc.dim("auto") : pc.magenta(state.agent);
  const modelLabel = pc.yellow(state.model);
  const tokenLabel = formatTokens(state.tokenEstimate);
  const modeLabel = state.mode === "DETERMINISTIC" ? pc.yellow("DET") : "";
  const streamLabel = state.streaming ? pc.green("◉ streaming") : "";

  const parts = [
    `Session: ${sessionLabel}`,
    `Agent: ${agentLabel}`,
    `Model: ${modelLabel}`,
    `Tokens: ${tokenLabel}`,
    modeLabel,
    streamLabel,
  ].filter(Boolean);

  return parts.join(pc.dim(" │ "));
}

/** Render the full header block (divider + status + divider). */
export function renderHeader(state: StatusBarState): string {
  const width = getTermWidth();
  const divider = pc.dim(DIVIDER_CHAR.repeat(Math.min(width, 80)));
  const bar = renderStatusBar(state);
  return `${divider}\n${bar}\n${divider}`;
}

function formatTokens(estimate: number): string {
  if (estimate === 0) return pc.dim("0");
  const k = Math.round(estimate / 1000);
  if (estimate > 100_000) return pc.red(`~${k}K`);
  if (estimate > 50_000) return pc.yellow(`~${k}K`);
  return pc.green(`~${k}K`);
}

/** Get terminal width, defaulting to 80. */
export function getTermWidth(): number {
  return process.stdout.columns || 80;
}
