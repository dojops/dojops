import * as path from "path";
import { ExecutionPolicy } from "./types";

export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export function checkWriteAllowed(filePath: string, policy: ExecutionPolicy): void {
  if (!policy.allowWrite) {
    throw new PolicyViolationError(`Write operations are not allowed by policy`, "allowWrite");
  }

  const resolved = path.resolve(filePath);

  for (const denied of policy.deniedWritePaths) {
    const deniedResolved = path.resolve(denied);
    if (resolved.startsWith(deniedResolved)) {
      throw new PolicyViolationError(
        `Write to ${resolved} is denied by policy (matches ${deniedResolved})`,
        "deniedWritePaths",
      );
    }
  }

  if (policy.allowedWritePaths.length > 0) {
    const allowed = policy.allowedWritePaths.some((p) => {
      const allowedResolved = path.resolve(p);
      return resolved.startsWith(allowedResolved);
    });
    if (!allowed) {
      throw new PolicyViolationError(
        `Write to ${resolved} is not in allowed paths`,
        "allowedWritePaths",
      );
    }
  }
}

export function checkFileSize(sizeBytes: number, policy: ExecutionPolicy): void {
  if (sizeBytes > policy.maxFileSizeBytes) {
    throw new PolicyViolationError(
      `File size ${sizeBytes} exceeds limit of ${policy.maxFileSizeBytes} bytes`,
      "maxFileSizeBytes",
    );
  }
}

export function filterEnvVars(policy: ExecutionPolicy): Record<string, string> {
  if (policy.allowEnvVars.length === 0) return {};

  const filtered: Record<string, string> = {};
  for (const key of policy.allowEnvVars) {
    if (process.env[key] !== undefined) {
      filtered[key] = process.env[key]!;
    }
  }
  return filtered;
}

export const DEFAULT_POLICY: ExecutionPolicy = {
  allowWrite: false,
  allowedWritePaths: [],
  deniedWritePaths: [],
  allowNetwork: false,
  allowEnvVars: [],
  timeoutMs: 30_000,
  maxFileSizeBytes: 1_048_576,
  requireApproval: true,
};
