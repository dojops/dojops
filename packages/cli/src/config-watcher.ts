import fs from "node:fs";

export type ConfigChangeCallback = (changedPath: string) => void;

/**
 * Watches config file paths for changes and invokes a callback on modification.
 * Uses fs.watch() for event-based (non-polling) file watching with debouncing
 * to avoid rapid-fire reloads when editors perform multiple writes.
 */
export class ConfigWatcher {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;
  private readonly paths: string[];
  private readonly onChange: ConfigChangeCallback;

  constructor(paths: string[], onChange: ConfigChangeCallback, debounceMs = 300) {
    this.paths = paths;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
  }

  /** Begin watching all paths that currently exist. Missing paths are skipped silently. */
  start(): void {
    for (const filePath of this.paths) {
      this.watchPath(filePath);
    }
  }

  /** Close all watchers and cancel pending debounce timers. */
  stop(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /** Returns true if at least one path is being actively watched. */
  isWatching(): boolean {
    return this.watchers.size > 0;
  }

  private watchPath(filePath: string): void {
    // Skip if already watching this path
    if (this.watchers.has(filePath)) return;

    try {
      // Check existence before calling fs.watch — avoids ENOENT
      if (!fs.existsSync(filePath)) return;

      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === "change" || eventType === "rename") {
          this.scheduleCallback(filePath);
        }
      });

      watcher.on("error", (err: NodeJS.ErrnoException) => {
        // File deleted or permissions changed — clean up this watcher
        if (err.code === "ENOENT" || err.code === "EPERM") {
          this.unwatchPath(filePath);
          return;
        }
        // Log unexpected errors but don't crash
        console.warn(`[dojops] Config watcher error for ${filePath}: ${err.message}`);
        this.unwatchPath(filePath);
      });

      this.watchers.set(filePath, watcher);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT" || e.code === "EPERM") {
        // File doesn't exist or no permission — skip silently
        return;
      }
      console.warn(`[dojops] Could not watch ${filePath}: ${e.message}`);
    }
  }

  private unwatchPath(filePath: string): void {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(filePath);
    }
    const timer = this.debounceTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filePath);
    }
  }

  private scheduleCallback(filePath: string): void {
    // Clear any existing debounce timer for this path
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);

      // Verify the file still exists before firing callback.
      // If the file was deleted, clean up the watcher.
      if (!fs.existsSync(filePath)) {
        this.unwatchPath(filePath);
        return;
      }

      this.onChange(filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }
}
