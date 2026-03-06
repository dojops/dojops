export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  VALIDATION_ERROR: 2,
  APPROVAL_REQUIRED: 3,
  LOCK_CONFLICT: 4,
  NO_PROJECT: 5,
  SECURITY_ISSUES: 6,
  CRITICAL_VULNERABILITIES: 7,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Thrown by command handlers instead of calling process.exit() directly.
 * main() catches this and exits cleanly without triggering duplicate
 * @clack/prompts output.
 */
export class CLIError extends Error {
  constructor(
    public readonly exitCode: ExitCodeValue,
    message?: string,
  ) {
    super(message ?? "");
    this.name = "CLIError";
  }
}

/** Extract a message string from an unknown error value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
