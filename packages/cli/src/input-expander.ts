import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Matches @path/to/file references in user input.
 * Requires a file extension to avoid false positives on @mentions.
 * Negative lookbehind prevents matching \\@, @@, or word@.
 */
const FILE_REF_RE = /(?<![\\@\w])@((?:\.\.?\/)?[\w./-]+\.\w+)/g;

/**
 * Expand `@path/to/file` references into inline file contents.
 * Files > 256KB or non-existent paths are left unchanged.
 */
export function expandFileReferences(input: string, cwd: string): string {
  return input.replace(FILE_REF_RE, (match, filePath: string) => {
    // Block paths with excessive traversal (more than 3 levels up)
    const traversalCount = (filePath.match(/\.\.\//g) || []).length;
    if (traversalCount > 3) return match;
    const absPath = path.resolve(cwd, filePath);
    // Block absolute paths and paths reaching sensitive directories
    const sensitive = [".ssh", ".gnupg", ".aws", ".config/gcloud"];
    if (
      sensitive.some(
        (s) => absPath.includes(path.sep + s + path.sep) || absPath.endsWith(path.sep + s),
      )
    ) {
      return match;
    }
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size > 256 * 1024) return match;
      const content = fs.readFileSync(absPath, "utf-8");
      return `\n<file path="${filePath}">\n${content}\n</file>\n`;
    } catch {
      return match; // not a file — leave as-is (e.g. @mentions)
    }
  });
}
