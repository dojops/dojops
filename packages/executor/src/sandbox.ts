import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFileSync } from "@dojops/sdk";
import { ExecutionPolicy } from "./types";
import { checkWriteAllowed, checkFileSize, isPathWithin, PolicyViolationError } from "./policy";

export interface SandboxedFs {
  writeFileSync(filePath: string, content: string): void;
  mkdirSync(dirPath: string): void;
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string): string;
}

export function createSandboxedFs(policy: ExecutionPolicy): SandboxedFs {
  return {
    writeFileSync(filePath: string, content: string): void {
      // Resolve symlinks before policy check to prevent symlink-based path escapes.
      // If the target doesn't exist yet, resolve the parent directory instead.
      let resolved: string;
      try {
        resolved = fs.realpathSync(path.resolve(filePath));
      } catch {
        const parentDir = path.dirname(path.resolve(filePath));
        try {
          resolved = path.join(fs.realpathSync(parentDir), path.basename(filePath));
        } catch {
          resolved = path.resolve(filePath);
        }
      }
      checkWriteAllowed(resolved, policy);
      checkFileSize(Buffer.byteLength(content, "utf-8"), policy);
      atomicWriteFileSync(resolved, content);
    },

    mkdirSync(dirPath: string): void {
      checkWriteAllowed(dirPath, policy);
      fs.mkdirSync(dirPath, { recursive: true });
    },

    existsSync(filePath: string): boolean {
      return fs.existsSync(filePath);
    },

    readFileSync(filePath: string): string {
      // Resolve symlinks to prevent reading outside allowed paths
      let resolved: string;
      try {
        resolved = fs.realpathSync(path.resolve(filePath));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          throw new PolicyViolationError(`File not found: ${filePath}`, "readFileSync");
        }
        throw err;
      }

      // Reject reads from denied paths
      for (const denied of policy.deniedWritePaths) {
        if (isPathWithin(resolved, denied)) {
          throw new PolicyViolationError(
            `Read from ${resolved} is denied by policy (matches ${path.resolve(denied)})`,
            "deniedWritePaths",
          );
        }
      }

      // M-1: Restrict reads to allowed paths when specified
      if (policy.allowedReadPaths && policy.allowedReadPaths.length > 0) {
        const allowed = policy.allowedReadPaths.some((p) => isPathWithin(resolved, p));
        if (!allowed) {
          throw new PolicyViolationError(
            `Read from ${resolved} is not in allowed read paths`,
            "allowedReadPaths",
          );
        }
      }

      // Enforce file size limit before reading
      const stat = fs.statSync(resolved);
      checkFileSize(stat.size, policy);

      return fs.readFileSync(resolved, "utf-8");
    },
  };
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new PolicyViolationError(
          message ?? `Execution timed out after ${timeoutMs}ms`,
          "timeoutMs",
        ),
      );
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
