import pc from "picocolors";

/**
 * DojOps CLI mascot — 10x10 pixel art slime blob, ANSI half-block art.
 * Friendly cyan slime with the DojOps brand color.
 */

// Color map: slime palette
const C: Record<string, string | null> = {
  ".": null,
  S: "#06b6d4", // slime body (brand cyan)
  s: "#22d3ee", // slime highlight (bright cyan)
  d: "#0e7490", // dark outline / shadow
  W: "#e8edf5", // eye whites
  P: "#0f172a", // pupils
  m: "#67e8f9", // mouth / shine
};

// 10x10 slime — friendly blob with DojOps cyan
const FRAME = [
  "...dSSd...", // top bump
  "..dSSSSd..", // head
  ".dSSSSSSd.", // wide face
  ".dSWPWPSd.", // eyes (white + pupil)
  ".dSSmmSSd.", // mouth
  ".dSSSSSSd.", // body
  "dSSSsSSSsd", // body with shine
  "dSSSSSSSSd", // wide base
  ".dSSSSSsd.", // base edge + shine
  "..dddddd..", // shadow/ground
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
