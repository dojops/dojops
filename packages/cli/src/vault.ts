/**
 * Encrypted secrets vault — AES-256-GCM encryption for API tokens.
 *
 * Key derivation:
 *   1. DOJOPS_VAULT_KEY env var (explicit passphrase)
 *   2. Random 32-byte key stored at ~/.dojops/vault-key (generated on first use)
 *
 * Migration: If tokens were encrypted with the legacy machine-derived key
 * (hostname:username:homedir), decryption falls back to the old key and
 * re-encrypts with the new key on success.
 *
 * Ciphertext format: "enc:v1:<base64(iv[12] + authTag[16] + ciphertext)>"
 *
 * Each value has a unique random IV so identical plaintexts produce
 * different ciphertexts. The authTag prevents tampering.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import os from "node:os";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT = "dojops-vault-v1";
const ENCRYPTED_PREFIX = "enc:v1:";

/** Derive a 256-bit key from a passphrase using scrypt. */
function deriveKey(passphrase: string): Buffer {
  return scryptSync(passphrase, SALT, KEY_LENGTH);
}

/** Path to the persistent random vault key file. */
function vaultKeyPath(): string {
  return path.join(os.homedir(), ".dojops", "vault-key");
}

/**
 * Load or generate the persistent random vault key.
 * On first use, generates a random 32-byte key and stores it at
 * ~/.dojops/vault-key with 0o600 permissions.
 */
function loadOrCreateVaultKeyFile(): string {
  const keyPath = vaultKeyPath();
  try {
    const existing = fs.readFileSync(keyPath, "utf-8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // File doesn't exist yet — generate below
  }

  const dir = path.dirname(keyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); // NOSONAR
  }
  const key = randomBytes(32).toString("hex");
  fs.writeFileSync(keyPath, key + "\n", { encoding: "utf-8", mode: 0o600 }); // NOSONAR
  return key;
}

/** Get the vault key — from env or persistent random key file. */
function getVaultKey(): Buffer {
  const envKey = process.env.DOJOPS_VAULT_KEY;
  if (envKey) return deriveKey(envKey);

  const fileKey = loadOrCreateVaultKeyFile();
  return deriveKey(fileKey);
}

/**
 * Get the legacy machine-derived vault key (for migration).
 * Used to attempt decryption of tokens encrypted before the random key was introduced.
 */
function getLegacyVaultKey(): Buffer {
  let username = "unknown";
  try {
    username = os.userInfo().username ?? "unknown";
  } catch {
    // os.userInfo() can throw on some platforms
  }
  const machineId = `${os.hostname()}:${username}:${os.homedir()}`;
  return deriveKey(machineId);
}

/** Try to decrypt with a specific key. Returns null on failure. */
function tryDecryptWithKey(ciphertext: string, key: Buffer): string | null {
  try {
    const packed = Buffer.from(ciphertext.slice(ENCRYPTED_PREFIX.length), "base64");
    if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) return null;

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const data = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(data) + decipher.final("utf-8");
  } catch {
    return null;
  }
}

/** Check if a value is encrypted. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/** Encrypt a plaintext string. Returns "enc:v1:<base64>" format. */
export function encrypt(plaintext: string): string {
  const key = getVaultKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: iv + authTag + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return ENCRYPTED_PREFIX + packed.toString("base64");
}

/** Decrypt an "enc:v1:<base64>" value back to plaintext. */
export function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) return ciphertext;

  // Try current key first
  const key = getVaultKey();
  const result = tryDecryptWithKey(ciphertext, key);
  if (result !== null) return result;

  // Migration path: try legacy machine-derived key
  // Skip if env key is set (user explicitly chose their key)
  if (!process.env.DOJOPS_VAULT_KEY) {
    const legacyKey = getLegacyVaultKey();
    const legacyResult = tryDecryptWithKey(ciphertext, legacyKey);
    if (legacyResult !== null) return legacyResult;
  }

  throw new Error("Decryption failed: key mismatch or corrupted data");
}

/** Encrypt all token values in a tokens map. Already-encrypted values are skipped. */
export function encryptTokens(tokens: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [provider, value] of Object.entries(tokens)) {
    if (!value) continue;
    result[provider] = isEncrypted(value) ? value : encrypt(value);
  }
  return result;
}

/** Decrypt all token values in a tokens map. Plaintext values pass through.
 * If any token was decrypted using the legacy key, `needsReEncrypt` is set on the result.
 */
export function decryptTokens(tokens: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  let migratedCount = 0;
  for (const [provider, value] of Object.entries(tokens)) {
    if (!value) continue;
    if (!isEncrypted(value)) {
      result[provider] = value;
      continue;
    }
    try {
      // Try current key
      const key = getVaultKey();
      const decrypted = tryDecryptWithKey(value, key);
      if (decrypted !== null) {
        result[provider] = decrypted;
        continue;
      }

      // Try legacy key (migration path)
      if (!process.env.DOJOPS_VAULT_KEY) {
        const legacyKey = getLegacyVaultKey();
        const legacyDecrypted = tryDecryptWithKey(value, legacyKey);
        if (legacyDecrypted !== null) {
          result[provider] = legacyDecrypted;
          migratedCount++;
          continue;
        }
      }

      // Both keys failed — return raw value
      result[provider] = value;
    } catch {
      result[provider] = value;
    }
  }

  if (migratedCount > 0) {
    // Mark for re-encryption by the caller (config.ts saveConfig)
    Object.defineProperty(result, "_needsReEncrypt", { value: true, enumerable: false });
  }
  return result;
}
