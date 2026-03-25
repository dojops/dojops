export interface SplitFile {
  path: string;
  content: string;
}

/**
 * Split LLM output containing multiple files into separate entries.
 *
 * Supports two marker formats:
 * 1. `--- FILE: path/to/file ---` (recommended)
 * 2. `# FILE: path/to/file` (alternative)
 *
 * Content between markers belongs to the preceding file.
 */
export function splitMultiFileOutput(output: string): SplitFile[] {
  const FILE_MARKER = /^(?:---\s*FILE:\s*(.+?)\s*---|#\s*FILE:\s*(.+?)\s*)$/gm;
  const files: SplitFile[] = [];
  let lastIndex = 0;
  let currentPath: string | null = null;
  let match: RegExpExecArray | null;

  // Reset regex state
  FILE_MARKER.lastIndex = 0;

  while ((match = FILE_MARKER.exec(output)) !== null) {
    // Save content of previous file
    if (currentPath) {
      const content = output.slice(lastIndex, match.index).trim();
      if (content) {
        files.push({ path: currentPath, content });
      }
    }

    currentPath = (match[1] ?? match[2]).trim();
    lastIndex = match.index + match[0].length;
  }

  // Handle last file (or single-file output without markers)
  if (currentPath) {
    const content = output.slice(lastIndex).trim();
    if (content) {
      files.push({ path: currentPath, content });
    }
  }

  // No markers found — return as single unnamed file
  if (files.length === 0 && output.trim()) {
    return [{ path: "", content: output.trim() }];
  }

  return files;
}

/**
 * Check if a .dops skill specifies multiple output files.
 * Returns true when the `files` array has more than one entry.
 */
export function isMultiFileSkill(filesSpec: Array<{ path: string }>): boolean {
  return filesSpec.length > 1;
}
