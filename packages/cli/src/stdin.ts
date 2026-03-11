import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read all data from stdin if it's being piped (not a TTY).
 * Returns the piped content or undefined if stdin is a TTY.
 */
export function readStdin(): string | undefined {
  if (process.stdin.isTTY) return undefined;
  try {
    return fs.readFileSync(0, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Read prompt content from a file. Supports .txt, .md, and other text files.
 * Throws if the file doesn't exist or can't be read.
 */
export function readPromptFile(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const content = fs.readFileSync(resolved, "utf-8").trim();
  if (!content) {
    throw new Error(`File is empty: ${filePath}`);
  }
  return content;
}
