import pc from "picocolors";

/**
 * DojOps CLI mascot — 12x10 pixel art robot, ANSI half-block art.
 * Matches the dojops-mascot-flat.svg brand mascot with mismatched eyes.
 */

// Color map: robot palette
const C: Record<string, string | null> = {
  ".": null,
  b: "#3b82f6", // blue body
  A: "#0ea5e9", // sky blue accents (antenna tips, toe highlights)
  M: "#d946ef", // fuchsia (left eye, right hand)
  C: "#06b6d4", // cyan (right eye, left hand)
};

// 12x10 robot — brand mascot with antenna, mismatched eyes, arms
const FRAME = [
  "............", // padding
  "..A......A..", // antenna tips
  "...b....b...", // antenna stems
  "..bbbbbbbb..", // head
  ".bbMbbbbCbb.", // face (pink + cyan eyes)
  "bbbbbbbbbbbb", // wide body
  "b.bbbbbbbb.b", // body + arms
  "C..b....b..M", // hands (cyan left, pink right)
  "...bbA.bbA..", // feet with highlights
  "............", // padding
];

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function fg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function bg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

const RST = "\x1b[0m";

const GRID_ROWS = FRAME.length;
const GRID_COLS = FRAME[0].length;

/**
 * Render the mascot as an array of terminal lines.
 * Each line is left-padded with `indent` spaces.
 */
export function renderMascot(indent = 2): string[] {
  const grid = FRAME.map((row) => [...row].map((ch) => C[ch] ?? null));
  const lines: string[] = [];

  for (let y = 0; y < GRID_ROWS; y += 2) {
    let line = " ".repeat(indent);
    for (let x = 0; x < GRID_COLS; x++) {
      const top = grid[y]?.[x] ?? null;
      const bot = grid[y + 1]?.[x] ?? null;

      if (top && bot) {
        line += `${fg(top)}${bg(bot)}\u2580${RST}`;
      } else if (top) {
        line += `${fg(top)}\u2580${RST}`;
      } else if (bot) {
        line += `${fg(bot)}\u2584${RST}`;
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Render the mascot alongside text lines, producing a side-by-side layout.
 * The mascot is on the left, text lines are aligned to the right.
 */
export function renderMascotWithText(textLines: string[], gap = 3): string {
  const mascotLines = renderMascot(2);
  const mascotVisualWidth = 2 + GRID_COLS; // indent + grid width

  const output: string[] = [];
  const maxRows = Math.max(mascotLines.length, textLines.length);
  const spacer = " ".repeat(gap);

  for (let i = 0; i < maxRows; i++) {
    const left = mascotLines[i] ?? " ".repeat(mascotVisualWidth);
    const right = textLines[i] ?? "";
    output.push(`${left}${spacer}${right}`);
  }

  return output.join("\n");
}

/**
 * Print a compact mascot with the DojOps branding for chat mode welcome.
 */
export function printChatMascot(provider: string, model: string): void {
  const textLines = [
    pc.bold(pc.cyan("DojOps Interactive Chat")),
    "",
    `${pc.dim("Provider:")} ${pc.white(provider)}  ${pc.dim("Model:")} ${pc.white(model)}`,
    "",
    pc.dim("Type a message to chat, or ") + pc.cyan("/help") + pc.dim(" for commands."),
  ];

  console.log();
  console.log(renderMascotWithText(textLines));
  console.log();
}
