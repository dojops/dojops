import pc from "picocolors";
import type { RepoContext } from "@dojops/core";
import {
  type PipelinePreferences,
  type PipelineStage,
  STAGE_DISPLAY,
  buildPipelineColumns,
} from "./arise-types";

const BOX_W = 12; // inner width of each box

// ── Public API ───────────────────────────────────────────────────────

/**
 * Renders a visual ASCII pipeline diagram from user preferences.
 * Returns a plain string (with picocolors markup) ready for p.note().
 */
export function renderPipelineDiagram(prefs: PipelinePreferences, ctx: RepoContext): string {
  const columns = buildPipelineColumns(prefs.stages);
  if (columns.length === 0) return pc.dim("(no stages selected)");

  // Resolve display labels and tool names for each stage
  const resolve = (stage: PipelineStage) => ({
    label: STAGE_DISPLAY[stage].label,
    tool: STAGE_DISPLAY[stage].toolFn(prefs, ctx),
  });

  // Check if any column has multiple items (parallel)
  const hasParallel = columns.some((col) => col.length > 1);

  if (!hasParallel) {
    return renderLinear(columns, resolve);
  }
  return renderWithParallel(columns, resolve);
}

// ── Linear layout (all single-item columns) ──────────────────────────

function renderLinear(
  columns: PipelineStage[][],
  resolve: (s: PipelineStage) => { label: string; tool: string },
): string {
  const boxes = columns.map((col) => {
    const { label } = resolve(col[0]);
    return makeBox(label);
  });

  // Join boxes with arrows: each box is 3 lines (top, mid, bot)
  const arrow = ["    ", pc.green("--->"), "    "];
  const lines: string[] = ["", "", ""];
  for (let i = 0; i < boxes.length; i++) {
    if (i > 0) {
      lines[0] += arrow[0];
      lines[1] += arrow[1];
      lines[2] += arrow[2];
    }
    lines[0] += boxes[i][0];
    lines[1] += boxes[i][1];
    lines[2] += boxes[i][2];
  }
  return lines.join("\n");
}

// ── Parallel layout (fork/join bracket for multi-item columns) ───────

function renderWithParallel(
  columns: PipelineStage[][],
  resolve: (s: PipelineStage) => { label: string; tool: string },
): string {
  // Find max height across all columns (for vertical alignment)
  const maxParallel = Math.max(...columns.map((c) => c.length));
  // Each box is 3 lines tall; parallel boxes are stacked with 1-line gap
  const totalHeight = maxParallel * 3 + (maxParallel - 1);

  // Build each column as an array of strings (one per line)
  const rendered: string[][] = [];

  for (const col of columns) {
    if (col.length === 1) {
      // Single box: center vertically in totalHeight
      const { label } = resolve(col[0]);
      const box = makeBox(label);
      const boxWidth = stripAnsi(box[0]).length;
      const padded = centerVertically(box, totalHeight, boxWidth);
      rendered.push(padded);
    } else {
      // Parallel: stack boxes vertically
      const colLines: string[] = [];
      for (let i = 0; i < col.length; i++) {
        if (i > 0) colLines.push(""); // gap between boxes
        const { label } = resolve(col[i]);
        const box = makeBox(label);
        colLines.push(...box);
      }
      // Pad to totalHeight
      while (colLines.length < totalHeight) colLines.push("");
      rendered.push(colLines);
    }
  }

  // Build connectors between columns
  const result: string[][] = [];
  for (let ci = 0; ci < rendered.length; ci++) {
    if (ci > 0) {
      const prevCol = columns[ci - 1];
      const nextCol = columns[ci];
      result.push(buildConnector(prevCol.length, nextCol.length, totalHeight));
    }
    result.push(rendered[ci]);
  }

  // Combine all column-arrays line by line
  const output: string[] = [];
  for (let row = 0; row < totalHeight; row++) {
    let line = "";
    for (const colArr of result) {
      line += colArr[row] ?? "";
    }
    output.push(line);
  }

  return output.join("\n");
}

// ── Box rendering ────────────────────────────────────────────────────

function makeBox(label: string): [string, string, string] {
  const padLabel = centerText(label, BOX_W);
  return [
    pc.cyan(`\u250c${"\u2500".repeat(BOX_W)}\u2510`),
    pc.cyan("\u2502") + pc.bold(padLabel) + pc.cyan("\u2502"),
    pc.cyan(`\u2514${"\u2500".repeat(BOX_W)}\u2518`),
  ];
}

/** Secondary line showing tool name below the box. */
export function makeBoxWithTool(label: string, tool: string): string[] {
  const padLabel = centerText(label, BOX_W);
  const padTool = centerText(`(${tool})`, BOX_W);
  return [
    pc.cyan(`\u250c${"\u2500".repeat(BOX_W)}\u2510`),
    pc.cyan("\u2502") + pc.bold(padLabel) + pc.cyan("\u2502"),
    pc.cyan("\u2502") + pc.dim(padTool) + pc.cyan("\u2502"),
    pc.cyan(`\u2514${"\u2500".repeat(BOX_W)}\u2518`),
  ];
}

// ── Connectors ───────────────────────────────────────────────────────

function buildConnector(leftCount: number, rightCount: number, totalHeight: number): string[] {
  const lines: string[] = [];
  const mid = Math.floor(totalHeight / 2);

  // Simple arrow for 1:1
  if (leftCount === 1 && rightCount === 1) {
    for (let i = 0; i < totalHeight; i++) {
      lines.push(i === mid ? pc.green("--->") : "    ");
    }
    return lines;
  }

  // Fan-out (1 -> N) or fan-in (N -> 1) or N -> M
  // Use a simple arrow at midpoint; the diagram is already readable
  // from box alignment
  for (let i = 0; i < totalHeight; i++) {
    lines.push(i === mid ? pc.green("--->") : "    ");
  }
  return lines;
}

// ── Helpers ──────────────────────────────────────────────────────────

function centerText(text: string, width: number): string {
  const stripped = text.length;
  if (stripped >= width) return text.slice(0, width);
  const left = Math.floor((width - stripped) / 2);
  const right = width - stripped - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

function centerVertically(box: string[], totalHeight: number, boxWidth: number): string[] {
  const padTop = Math.floor((totalHeight - box.length) / 2);
  const padBot = totalHeight - box.length - padTop;
  const empty = " ".repeat(boxWidth);
  return [
    ...Array.from({ length: padTop }, () => empty),
    ...box,
    ...Array.from({ length: padBot }, () => empty),
  ];
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Planned files list ───────────────────────────────────────────────

/** Returns a summary of files that will be generated. */
export function listPlannedFiles(prefs: PipelinePreferences): string[] {
  const files: string[] = [];

  switch (prefs.ciPlatform) {
    case "github-actions":
      files.push(".github/workflows/ci.yml");
      break;
    case "gitlab-ci":
      files.push(".gitlab-ci.yml");
      break;
    case "jenkinsfile":
      files.push("Jenkinsfile");
      break;
  }

  if (prefs.stages.includes("containerize")) {
    files.push("Dockerfile", ".dockerignore");
  }

  if (prefs.stages.includes("deploy")) {
    switch (prefs.deployTarget) {
      case "docker-compose":
        files.push("docker-compose.yml", "docker-compose.prod.yml");
        break;
      case "kubernetes":
        files.push("manifests/deployment.yaml", "manifests/service.yaml");
        break;
      case "helm":
        files.push("chart/Chart.yaml", "chart/values.yaml", "chart/templates/deployment.yaml");
        break;
      case "argocd":
        files.push("manifests/application.yaml");
        break;
      default:
        files.push("deploy/deploy.sh");
        break;
    }
  }

  if (
    prefs.stages.includes("security-scan") &&
    prefs.securityScanner === "trivy" &&
    (prefs.deployTarget === "kubernetes" || prefs.deployTarget === "helm")
  ) {
    files.push("manifests/trivy-operator.yaml");
  }

  if (prefs.stages.includes("security-scan") && prefs.securityScanner === "falco") {
    files.push("falco/falco-rules.yaml");
  }

  return files;
}
