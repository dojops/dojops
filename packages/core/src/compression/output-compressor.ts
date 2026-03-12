/**
 * Smart output compression for LLM context reduction.
 *
 * Strips ANSI codes, progress indicators, success lines, and duplicates
 * from CLI tool output before sending to the LLM. Typical savings: 70-90%.
 */

/** ANSI escape code pattern (SGR, cursor movement, erase, OSC) */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:\[[0-9;]*[A-Za-z]|\].*?(?:\x07|\x1B\\)|\([0-9A-Z])/g;

/** Progress-bar style lines: spinners, percentage bars, download counters */
const PROGRESS_RE =
  /^.*(?:\|[#=\-\s]*\||\.{3,}\s*\d+%|\b\d+%\b.*\[.*\]|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|downloading|pulling|fetching).*$/i;

/** Lines that only contain timestamps, blank space, or decorative separators */
const NOISE_RE = /^(?:\s*$|[-=~_*]{4,}\s*$|.*\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z\s*$)/;

/** Success/pass lines with no diagnostic value */
const SUCCESS_RE =
  /^.*\b(?:pass(?:ed|ing)?|ok|✓|✔|success(?:ful(?:ly)?)?|no (?:issues|errors|warnings|vulnerabilities) found|up to date|clean|0 (?:errors?|warnings?|issues?))\b.*$/i;

export interface CompressOptions {
  /** Keep success/pass lines (default: false) */
  keepSuccess?: boolean;
  /** Keep blank/separator lines (default: false) */
  keepNoise?: boolean;
  /** Maximum output lines (0 = unlimited, default: 500) */
  maxLines?: number;
  /** Maximum output bytes (0 = unlimited, default: 64KB) */
  maxBytes?: number;
  /** Minimum number of repetitions before collapsing (default: 2) */
  deduplicateThreshold?: number;
}

const DEFAULTS: Required<CompressOptions> = {
  keepSuccess: false,
  keepNoise: false,
  maxLines: 500,
  maxBytes: 64 * 1024,
  deduplicateThreshold: 2,
};

export interface CompressResult {
  /** Compressed output text */
  output: string;
  /** Original line count */
  originalLines: number;
  /** Compressed line count */
  compressedLines: number;
  /** Number of lines removed */
  linesRemoved: number;
  /** Number of duplicate groups collapsed */
  duplicateGroups: number;
  /** Compression ratio (0-1, lower = more compressed) */
  ratio: number;
}

/**
 * Compress CLI tool output for LLM consumption.
 *
 * Pipeline: strip ANSI → remove progress → remove success → deduplicate → truncate
 */
export function compressOutput(raw: string, options?: CompressOptions): CompressResult {
  const opts = { ...DEFAULTS, ...options };
  const originalLines = raw.split("\n").length;

  // Step 1: Strip ANSI escape codes
  const text = stripAnsi(raw);

  // Step 2: Split into lines and filter
  let lines = text.split("\n");

  // Step 3: Remove progress indicators
  lines = lines.filter((line) => !PROGRESS_RE.test(line));

  // Step 4: Remove noise (blank lines, separators)
  if (!opts.keepNoise) {
    lines = lines.filter((line) => !NOISE_RE.test(line));
  }

  // Step 5: Remove success/pass lines
  if (!opts.keepSuccess) {
    lines = lines.filter((line) => !SUCCESS_RE.test(line));
  }

  // Step 6: Deduplicate consecutive identical lines
  let duplicateGroups = 0;
  if (opts.deduplicateThreshold > 0) {
    const result = deduplicateLines(lines, opts.deduplicateThreshold);
    lines = result.lines;
    duplicateGroups = result.groups;
  }

  // Step 7: Truncate to max lines
  if (opts.maxLines > 0 && lines.length > opts.maxLines) {
    const removed = lines.length - opts.maxLines;
    // Keep head and tail for context
    const headCount = Math.floor(opts.maxLines * 0.3);
    const tailCount = opts.maxLines - headCount;
    lines = [
      ...lines.slice(0, headCount),
      `[...${removed} lines truncated...]`,
      ...lines.slice(-tailCount),
    ];
  }

  // Step 8: Truncate to max bytes
  let output = lines.join("\n");
  if (opts.maxBytes > 0 && Buffer.byteLength(output) > opts.maxBytes) {
    const buf = Buffer.from(output);
    const truncated = buf.subarray(0, opts.maxBytes).toString("utf-8");
    const lastNewline = truncated.lastIndexOf("\n");
    output =
      (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) +
      `\n[...truncated to ${Math.round(opts.maxBytes / 1024)}KB...]`;
  }

  const compressedLines = output.split("\n").length;

  return {
    output,
    originalLines,
    compressedLines,
    linesRemoved: originalLines - compressedLines,
    duplicateGroups,
    ratio: raw.length > 0 ? output.length / raw.length : 1,
  };
}

/** Strip all ANSI escape codes from a string. */
export function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_RE, "");
}

/**
 * Collapse consecutive identical lines into "line (×N)".
 * Returns the deduplicated lines and the number of groups collapsed.
 */
export function deduplicateLines(
  lines: string[],
  threshold: number,
): { lines: string[]; groups: number } {
  if (lines.length === 0) return { lines: [], groups: 0 };

  const result: string[] = [];
  let groups = 0;
  let current = lines[0];
  let count = 1;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === current) {
      count++;
    } else {
      if (count >= threshold) {
        result.push(`${current} (×${count})`);
        groups++;
      } else {
        for (let j = 0; j < count; j++) result.push(current);
      }
      current = lines[i];
      count = 1;
    }
  }

  // Flush last group
  if (count >= threshold) {
    result.push(`${current} (×${count})`);
    groups++;
  } else {
    for (let j = 0; j < count; j++) result.push(current);
  }

  return { lines: result, groups };
}

/**
 * Compress CI log specifically — more aggressive filtering tuned for CI output.
 * Keeps error/failure context, strips boilerplate.
 */
export function compressCILog(raw: string): CompressResult {
  return compressOutput(raw, {
    keepSuccess: false,
    keepNoise: false,
    maxLines: 300,
    maxBytes: 64 * 1024,
    deduplicateThreshold: 2,
  });
}

/**
 * Compress scanner output — preserves findings, strips boilerplate.
 */
export function compressScannerOutput(raw: string): CompressResult {
  return compressOutput(raw, {
    keepSuccess: false,
    keepNoise: false,
    maxLines: 200,
    maxBytes: 48 * 1024,
    deduplicateThreshold: 3,
  });
}
