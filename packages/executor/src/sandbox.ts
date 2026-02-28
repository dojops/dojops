import * as fs from "fs";
import * as path from "path";
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
      const tmpPath = `${filePath}.tmp`;
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
      return fs.readFileSync(filePath, "utf-8");
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
