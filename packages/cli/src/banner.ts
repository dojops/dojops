import * as fs from "fs";
import * as path from "path";
import pc from "picocolors";

interface SvgRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

function parseSvgRects(svg: string): SvgRect[] {
  const rects: SvgRect[] = [];
  const rectRegex = /<rect\s+([^>]+)\/>/g;
  let match;
  while ((match = rectRegex.exec(svg)) !== null) {
    const attrs = match[1];
    const x = Number(attrs.match(/x="(\d+)"/)?.[1]);
    const y = Number(attrs.match(/y="(\d+)"/)?.[1]);
    const width = Number(attrs.match(/width="(\d+)"/)?.[1]);
    const height = Number(attrs.match(/height="(\d+)"/)?.[1]);
    const fill = attrs.match(/fill="([^"]+)"/)?.[1] ?? "";
    if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height) && fill) {
      rects.push({ x, y, width, height, fill });
    }
  }
  return rects;
}

function parseViewBox(svg: string): [number, number] {
  const match = svg.match(/viewBox="\d+\s+\d+\s+(\d+)\s+(\d+)"/);
  if (match) {
    return [Number(match[1]), Number(match[2])];
  }
  return [32, 32];
}

function buildGrid(rects: SvgRect[], w: number, h: number): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: h }, () => Array(w).fill(null));
  for (const rect of rects) {
    for (let dy = 0; dy < rect.height; dy++) {
      for (let dx = 0; dx < rect.width; dx++) {
        const py = rect.y + dy;
        const px = rect.x + dx;
        if (py >= 0 && py < h && px >= 0 && px < w) {
          grid[py][px] = rect.fill;
        }
      }
    }
  }
  return grid;
}

function findBounds(grid: (string | null)[][]): [number, number, number, number] {
  let x0 = grid[0].length;
  let x1 = 0;
  let y0 = grid.length;
  let y1 = 0;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] !== null) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return [x0, x1, y0, y1];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function ansi_fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function ansi_bg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

const RESET = "\x1b[0m";

function renderHalfBlocks(
  grid: (string | null)[][],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  useColor: boolean,
): string[] {
  const lines: string[] = [];
  const startY = y0 % 2 === 0 ? y0 : y0 - 1;
  const endY = y1 % 2 === 0 ? y1 + 1 : y1;

  for (let y = startY; y <= endY; y += 2) {
    let line = "";
    let prevFg = "";
    let prevBg = "";

    for (let x = x0; x <= x1; x++) {
      const top = y < grid.length ? grid[y][x] : null;
      const bottom = y + 1 < grid.length ? grid[y + 1][x] : null;

      let char: string;
      let curFg = "";
      let curBg = "";

      if (top === null && bottom === null) {
        char = " ";
      } else if (top !== null && bottom !== null && top === bottom) {
        char = "\u2588"; // █
        if (useColor) {
          const [r, g, b] = hexToRgb(top);
          curFg = ansi_fg(r, g, b);
        }
      } else if (top !== null && bottom === null) {
        char = "\u2580"; // ▀
        if (useColor) {
          const [r, g, b] = hexToRgb(top);
          curFg = ansi_fg(r, g, b);
        }
      } else if (top === null && bottom !== null) {
        char = "\u2584"; // ▄
        if (useColor) {
          const [r, g, b] = hexToRgb(bottom);
          curFg = ansi_fg(r, g, b);
        }
      } else {
        // Both non-null, different colors: bg = top, fg = bottom
        char = "\u2584"; // ▄
        if (useColor) {
          const [tr, tg, tb] = hexToRgb(top!);
          const [br, bg_, bb] = hexToRgb(bottom!);
          curBg = ansi_bg(tr, tg, tb);
          curFg = ansi_fg(br, bg_, bb);
        }
      }

      if (useColor) {
        const needsChange = curFg !== prevFg || curBg !== prevBg;
        if (needsChange) {
          if (prevFg || prevBg) line += RESET;
          if (curBg) line += curBg;
          if (curFg) line += curFg;
          prevFg = curFg;
          prevBg = curBg;
        }
      }
      line += char;
    }

    if (useColor && (prevFg || prevBg)) {
      line += RESET;
    }
    lines.push(line);
  }

  return lines;
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
}

function asciiFallback(): string {
  const ver = pc.dim(`v${getVersion()}`);
  const c = (s: string) => pc.cyan(s);
  const r = (s: string) => pc.red(s);
  const d = (s: string) => pc.dim(s);

  const lines = [
    "",
    `  ${d("╭")}${d("─".repeat(14))}${d("╮")}`,
    `  ${d("│")} ${c("◉")}  ${d("═══")}  ${c("◉")}    ${d("│")}    ${pc.bold(pc.cyan("DojOps"))}`,
    `  ${d("│")} ${d("▄▄▄▄▄▄▄▄▄▄")} ${d("│")}      ${pc.dim("AI DevOps Automation Engine")}`,
    `  ${d("╰")}${d("─".repeat(14))}${d("╯")}`,
    `    ${r("┃")}${" ".repeat(8)}${r("┃")}       ${ver}`,
    `   ${r("━┻━")}${" ".repeat(6)}${r("━┻━")}`,
    "",
  ];
  return lines.join("\n");
}

export function createBanner(): string {
  const svgPath = path.join(__dirname, "..", "img", "official-dojops-icon-cli.svg");

  let svg: string;
  try {
    svg = fs.readFileSync(svgPath, "utf-8");
  } catch {
    return asciiFallback();
  }

  const rects = parseSvgRects(svg);
  const [w, h] = parseViewBox(svg);
  const grid = buildGrid(rects, w, h);
  const [x0, x1, y0, y1] = findBounds(grid);

  const useColor = pc.blue("x") !== "x";
  const artLines = renderHalfBlocks(grid, x0, x1, y0, y1, useColor);

  const artWidth = stripAnsi(artLines[0] || "").length;
  const gap = 4;
  const pad = artWidth + gap;

  const labels: Record<number, string> = {
    1: pc.bold(pc.cyan("DojOps")),
    2: pc.dim("AI DevOps Automation Engine"),
    3: pc.dim("Your AI sensei for DevOps"),
    5: pc.dim(`v${getVersion()}`),
  };

  const output: string[] = [""];
  for (let i = 0; i < artLines.length; i++) {
    const visibleWidth = stripAnsi(artLines[i]).length;
    const padding = " ".repeat(Math.max(0, pad - visibleWidth));
    const label = labels[i] || "";
    output.push(`  ${artLines[i]}${padding}${label}`);
  }
  output.push("");

  return output.join("\n");
}
