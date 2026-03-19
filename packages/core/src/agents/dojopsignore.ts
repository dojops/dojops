import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Load ignore patterns from a .dojopsignore file.
 * Returns empty array if the file doesn't exist.
 */
export function loadIgnorePatterns(projectRoot: string): string[] {
  const ignorePath = path.join(projectRoot, ".dojopsignore");
  try {
    const content = fs.readFileSync(ignorePath, "utf-8");
    return content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** Check if a relative path matches any ignore pattern. */
export function isIgnored(relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchIgnorePattern(relativePath, pattern)) return true;
  }
  return false;
}

/** Simple gitignore-style match: supports *, **, ?, and matchBase for bare names. */
function matchIgnorePattern(filePath: string, pattern: string): boolean {
  // Directory-only patterns (trailing /) match directory names in any segment
  const p = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  // Convert gitignore glob → regex: * = [^/]*, ** = .*, ? = [^/]
  const re = new RegExp(
    "^" +
      p
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "{{GLOBSTAR}}")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\{\{GLOBSTAR\}\}/g, ".*") +
      "$",
  );
  // Match full path or just the basename (matchBase behavior for bare names)
  return re.test(filePath) || (!p.includes("/") && re.test(path.basename(filePath)));
}
