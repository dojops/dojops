/**
 * Per-file undo/redo change tracking.
 *
 * Maintains a stack of content snapshots per file path, supporting multiple
 * levels of undo and redo. When a new change is recorded after an undo, the
 * redo stack from that point forward is discarded (standard undo/redo
 * semantics). Oldest entries are evicted when maxDepth is exceeded.
 */

/** Internal state for a single tracked file. */
interface FileStack {
  /** Ordered list of content snapshots. Index 0 is the oldest recorded state. */
  entries: string[];
  /**
   * Pointer into `entries`. Points to the "current" content the file holds.
   * -1 means the file is at its initial state (before the first recorded change).
   * 0..entries.length-1 indexes an entry that represents "after" content of
   * a recorded change.
   */
  cursor: number;
}

export const DEFAULT_MAX_DEPTH = 50;

export class FileHistory {
  private readonly stacks = new Map<string, FileStack>();
  private readonly maxDepth: number;

  constructor(maxDepth: number = DEFAULT_MAX_DEPTH) {
    this.maxDepth = Math.max(1, maxDepth);
  }

  /**
   * Record a file change. `beforeContent` is the content before the write,
   * `afterContent` is what was written.
   *
   * If the cursor is not at the head (user undid some changes), the entries
   * after the cursor are discarded before recording.
   */
  record(filePath: string, beforeContent: string, afterContent: string): void {
    let stack = this.stacks.get(filePath);

    if (!stack) {
      // First change for this file: store both before and after.
      stack = { entries: [beforeContent, afterContent], cursor: 1 };
      this.stacks.set(filePath, stack);
    } else {
      // Discard any redo entries beyond the current cursor
      stack.entries.length = stack.cursor + 1;

      // Append the new after-content
      stack.entries.push(afterContent);
      stack.cursor = stack.entries.length - 1;
    }

    // Evict oldest entries if we exceed maxDepth.
    // maxDepth counts the number of *changes*, which is entries.length - 1
    // (the first entry is the initial "before" state).
    while (stack.entries.length - 1 > this.maxDepth) {
      stack.entries.shift();
      stack.cursor--;
    }
  }

  /** Returns true if there is at least one change to undo for the given file. */
  canUndo(filePath: string): boolean {
    const stack = this.stacks.get(filePath);
    if (!stack) return false;
    return stack.cursor > 0;
  }

  /** Returns true if there is at least one change to redo for the given file. */
  canRedo(filePath: string): boolean {
    const stack = this.stacks.get(filePath);
    if (!stack) return false;
    return stack.cursor < stack.entries.length - 1;
  }

  /**
   * Undo the most recent change for a file.
   * Returns the content to restore, or undefined if nothing to undo.
   */
  undo(filePath: string): string | undefined {
    const stack = this.stacks.get(filePath);
    if (!stack || stack.cursor <= 0) return undefined;
    stack.cursor--;
    return stack.entries[stack.cursor];
  }

  /**
   * Redo a previously undone change for a file.
   * Returns the content to restore, or undefined if nothing to redo.
   */
  redo(filePath: string): string | undefined {
    const stack = this.stacks.get(filePath);
    if (!stack || stack.cursor >= stack.entries.length - 1) return undefined;
    stack.cursor++;
    return stack.entries[stack.cursor];
  }

  /** Returns the history depth and current cursor position for a file. */
  getHistory(filePath: string): { depth: number; current: number } {
    const stack = this.stacks.get(filePath);
    if (!stack) return { depth: 0, current: 0 };
    // depth = number of recorded changes (entries minus the initial state)
    return { depth: stack.entries.length - 1, current: stack.cursor };
  }

  /** Clear history for a specific file, or all files if no path given. */
  clear(filePath?: string): void {
    if (filePath) {
      this.stacks.delete(filePath);
    } else {
      this.stacks.clear();
    }
  }

  /** List all file paths that have recorded history. */
  getTrackedFiles(): string[] {
    return [...this.stacks.keys()];
  }
}
