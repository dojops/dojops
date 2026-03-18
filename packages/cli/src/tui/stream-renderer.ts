import pc from "picocolors";

export interface StreamRendererOptions {
  quiet?: boolean;
}

export interface StreamRenderer {
  /** Show a phase label (e.g., "Generating..."). Overwrites the current line. */
  showPhase(label: string): void;
  /** Write a chunk of streamed text to stdout. */
  writeChunk(chunk: string): void;
  /** Finalize output — ensure trailing newline and clean state. */
  finalize(): void;
}

/**
 * Creates a stream renderer for progressive terminal output.
 * Manages phase labels and streamed text chunks, handling line overwriting.
 */
export function createStreamRenderer(opts?: StreamRendererOptions): StreamRenderer {
  const quiet = opts?.quiet ?? false;
  let inPhase = false;
  let hasOutput = false;

  return {
    showPhase(label: string): void {
      if (quiet) return;
      // Overwrite current line with phase indicator
      process.stdout.write(`\r\x1b[K${pc.dim(label)}`);
      inPhase = true;
    },

    writeChunk(chunk: string): void {
      if (quiet) return;
      if (inPhase) {
        // Clear the phase line before writing first content
        process.stdout.write("\r\x1b[K");
        inPhase = false;
      }
      process.stdout.write(chunk);
      hasOutput = true;
    },

    finalize(): void {
      if (quiet) return;
      if (inPhase) {
        // Clear any lingering phase indicator
        process.stdout.write("\r\x1b[K");
        inPhase = false;
      }
      if (hasOutput) {
        // Ensure output ends with a newline
        process.stdout.write("\n");
      }
    },
  };
}
