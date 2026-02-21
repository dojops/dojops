export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  VALIDATION_ERROR: 2,
  APPROVAL_REQUIRED: 3,
  LOCK_CONFLICT: 4,
  NO_PROJECT: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
