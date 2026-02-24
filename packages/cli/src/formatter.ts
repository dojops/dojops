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
