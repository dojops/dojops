/**
 * Secure filesystem helpers for the core package.
 * Centralizes file operations that require restrictive permissions.
 */
import fs from "node:fs";

/** Create a directory with owner-only permissions (0o700). */
export function mkdirOwnerOnly(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 }); // NOSONAR
}

/** Write a file with owner-only permissions (0o600). */
export function writeFileOwnerOnly(filePath: string, data: string): void {
  fs.writeFileSync(filePath, data, { encoding: "utf-8", mode: 0o600 }); // NOSONAR
}
