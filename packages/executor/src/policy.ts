import * as path from "node:path";
import { ExecutionPolicy } from "./types";

/** Check if a resolved path is contained within a base directory path. */
export function isPathWithin(resolvedPath: string, basePath: string): boolean {
  const baseResolved = path.resolve(basePath);
  const baseWithSep = baseResolved.endsWith(path.sep) ? baseResolved : baseResolved + path.sep;
  return resolvedPath.startsWith(baseWithSep) || resolvedPath === baseResolved;
}

export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly rule: string,
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

/**
 * DevOps file write allowlist — glob-like patterns for files that DojOps tools
 * are expected to create or modify. When `enforceDevOpsAllowlist` is true and
 * no explicit `allowedWritePaths` are set, only these patterns are permitted.
 */
export const DEVOPS_WRITE_ALLOWLIST: string[] = [
  ".github/workflows/**",
  ".gitlab-ci.yml",
  "Jenkinsfile",
  "Dockerfile",
  "Dockerfile.*",
  "docker-compose*.yml",
  "docker-compose*.yaml",
  "helm/**",
  "k8s/**",
  "kubernetes/**",
  "manifests/**",
  "*.tf",
  "*.tfvars",
  "ansible/**",
  "playbook*.yml",
  "playbook*.yaml",
  "nginx/**",
  "nginx.conf",
  "prometheus/**",
  "alertmanager/**",
  "Makefile",
  "makefile",
  "systemd/**",
  "*.service",
  "*.timer",
];

/**
 * Tests whether a file path matches a DevOps allowlist pattern.
 * Supports simple glob matching: `*` (single segment wildcard) and `**` (recursive).
 */
export function matchesAllowlistPattern(filePath: string, pattern: string): boolean {
  // Normalize to forward slashes for matching
  const normalized = filePath.replaceAll("\\", "/");

  // Handle ** (recursive directory match)
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return normalized.startsWith(prefix + "/") || normalized === prefix;
  }

  // Handle * in filename (e.g. "Dockerfile.*", "docker-compose*.yml")
  if (pattern.includes("*")) {
    const regexStr =
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$"; // NOSONAR - replacement strings, not regex patterns
    const regex = new RegExp(regexStr);
    // Match against the full relative path or just the basename for simple patterns
    if (!pattern.includes("/")) {
      const basename = normalized.includes("/") ? normalized.split("/").pop()! : normalized;
      return regex.test(basename);
    }
    return regex.test(normalized);
  }

  // Exact match (or basename match for simple filenames)
  if (!pattern.includes("/")) {
    const basename = normalized.includes("/") ? normalized.split("/").pop()! : normalized;
    return basename === pattern;
  }
  return normalized === pattern;
}

/**
 * Checks if a file path matches any pattern in the DevOps allowlist.
 */
export function isDevOpsFile(filePath: string): boolean {
  // Extract a relative path: strip leading ./ and any absolute prefix
  let relative = filePath.replaceAll("\\", "/");
  if (path.isAbsolute(relative)) {
    // For absolute paths, resolve and check if under cwd (H-20)
    const resolved = path.resolve(filePath);
    const cwd = process.cwd();
    const cwdPrefix = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
    if (!resolved.startsWith(cwdPrefix) && resolved !== cwd) {
      // Absolute path outside cwd — reject to prevent basename bypass (e.g. ~/.ssh/Dockerfile)
      return false;
    }
    // Path is under cwd — extract relative portion
    relative = resolved.slice(cwdPrefix.length).replaceAll("\\", "/");

    const segments = relative.split("/");
    // Find the first segment that matches a known DevOps root
    const devopsRoots = new Set([
      ".github",
      ".gitlab-ci.yml",
      "helm",
      "k8s",
      "kubernetes",
      "manifests",
      "ansible",
      "nginx",
      "prometheus",
      "alertmanager",
      "systemd",
    ]);
    const rootIdx = segments.findIndex((s) => devopsRoots.has(s));
    if (rootIdx >= 0) {
      relative = segments.slice(rootIdx).join("/");
    }
    // For paths under cwd, basename fallback is safe since we've verified containment
  }
  // Strip leading ./
  if (relative.startsWith("./")) relative = relative.slice(2);

  return DEVOPS_WRITE_ALLOWLIST.some((pattern) => matchesAllowlistPattern(relative, pattern));
}

export function checkWriteAllowed(filePath: string, policy: ExecutionPolicy): void {
  if (!policy.allowWrite) {
    throw new PolicyViolationError(`Write operations are not allowed by policy`, "allowWrite");
  }

  const resolved = path.resolve(filePath);

  for (const denied of policy.deniedWritePaths) {
    if (isPathWithin(resolved, denied)) {
      throw new PolicyViolationError(
        `Write to ${resolved} is denied by policy (matches ${path.resolve(denied)})`,
        "deniedWritePaths",
      );
    }
  }

  if (policy.allowedWritePaths.length > 0) {
    const allowed = policy.allowedWritePaths.some((p) => isPathWithin(resolved, p));
    if (!allowed) {
      throw new PolicyViolationError(
        `Write to ${resolved} is not in allowed paths`,
        "allowedWritePaths",
      );
    }
    return; // Explicit allowedWritePaths takes precedence over DevOps allowlist
  }

  // Enforce DevOps allowlist when no explicit allowedWritePaths are set
  if (policy.enforceDevOpsAllowlist) {
    if (!isDevOpsFile(filePath)) {
      throw new PolicyViolationError(
        `Write to ${resolved} is not a recognized DevOps file. Use --allow-all-paths to bypass.`,
        "enforceDevOpsAllowlist",
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
  enforceDevOpsAllowlist: true,
  /** @advisory Not enforced at runtime — reserved for future OS-level sandboxing. */
  allowNetwork: false,
  /** @advisory Names of env vars to pass through. Use `filterEnvVars(policy)` to apply manually. */
  allowEnvVars: [],
  timeoutMs: 30_000,
  maxFileSizeBytes: 1_048_576,
  requireApproval: false,
  skipVerification: false,
};
