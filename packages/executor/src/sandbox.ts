import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ExecutionPolicy } from "./types";
import { checkWriteAllowed, checkFileSize, PolicyViolationError } from "./policy";

export interface SandboxedFs {
  writeFileSync(filePath: string, content: string): void;
  mkdirSync(dirPath: string): void;
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string): string;
}

export function createSandboxedFs(policy: ExecutionPolicy): SandboxedFs {
  return {
    writeFileSync(filePath: string, content: string): void {
      checkWriteAllowed(filePath, policy);
      checkFileSize(Buffer.byteLength(content, "utf-8"), policy);
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${filePath}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      try {
        fs.writeFileSync(tmpPath, content, "utf-8");
        fs.renameSync(tmpPath, filePath);
      } catch (err) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* .tmp already gone */
        }
        throw err;
      }
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

      // Reject reads from denied paths (with separator to prevent prefix collision)
      for (const denied of policy.deniedWritePaths) {
        const deniedResolved = path.resolve(denied);
        const deniedWithSep = deniedResolved.endsWith(path.sep)
          ? deniedResolved
          : deniedResolved + path.sep;
        if (resolved.startsWith(deniedWithSep) || resolved === deniedResolved) {
          throw new PolicyViolationError(
            `Read from ${resolved} is denied by policy (matches ${deniedResolved})`,
            "deniedWritePaths",
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
