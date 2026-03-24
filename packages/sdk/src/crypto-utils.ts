/**
 * Shared cryptographic utilities.
 */
import { createHash } from "node:crypto";

/** Compute SHA-256 hex digest of a string. */
export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
