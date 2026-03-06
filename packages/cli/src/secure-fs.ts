/**
 * Secure filesystem helpers for the CLI package.
 * Centralizes file operations that require restrictive permissions
 * so that security audit tools (SonarCloud S2612) need only review this single file.
 *
 * Permissions:
 * - Directories: 0o700 (owner rwx only)
 * - Files: 0o600 (owner rw only)
 * - Executables: 0o755 (owner rwx, group/other rx — standard for binaries)
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

/** Create a directory for executables with standard permissions (0o755). */
export function mkdirExecutable(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 }); // NOSONAR
}

/** Set file permissions to executable (0o755). */
export function chmodExecutable(filePath: string): void {
  fs.chmodSync(filePath, 0o755); // NOSONAR
}
