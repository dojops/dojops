import pc from "picocolors";

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
  const limit = 50;
  const preview = lines.slice(0, limit);
  const formatted = preview.map((l) => `    ${pc.dim(l)}`).join("\n");
  if (lines.length > limit) {
    const truncationNote = pc.dim(
      `... (${lines.length - limit} more lines — use --output json for full content)`,
    );
    return `${formatted}\n    ${truncationNote}`;
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
  switch (level.toLowerCase()) {
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

// ── ANSI-safe text wrapping for p.note() ─────────────────────────

/** Strip ANSI escape codes for accurate width measurement. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, ""); // NOSONAR - complex regex, cannot use replaceAll
}

/**
 * Word-wrap a single line to fit within `maxWidth` visible characters.
 * Preserves leading indentation on continuation lines.
 */
function wrapLine(line: string, maxWidth: number): string[] {
  const visible = stripAnsi(line);
  if (visible.length <= maxWidth) return [line];

  // Detect leading plain-text indent
  const indentMatch = /^(\s*)/.exec(visible);
  const indent = indentMatch ? indentMatch[1] : "";

  const words = visible.split(/(\s+)/);
  const result: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length > maxWidth && current.length > 0) {
      result.push(current.trimEnd());
      current = indent + word.trimStart();
    } else {
      current += word;
    }
  }
  if (current.length > 0) result.push(current.trimEnd());

  return result;
}

/**
 * Wrap all lines in a multi-line string so no visible line exceeds the
 * terminal width minus `p.note()` box-drawing overhead (7 chars).
 *
 * Safe for strings containing ANSI color codes — measures visible width only.
 */
export function wrapForNote(text: string): string {
  // p.note() overhead: "│  " (3) on the left + "  │" (3) on the right + 1 safety
  const cols = Math.min(process.stdout.columns || 80, 200);
  const maxWidth = Math.max(30, cols - 7);

  return text
    .split("\n")
    .flatMap((line) => wrapLine(line, maxWidth))
    .join("\n");
}
