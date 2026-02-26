import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const MAX_CONTENT_SIZE = 50 * 1024; // 50 KB

export function atomicWriteFileSync(filePath: string, content: string): void {
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
}

export function restoreBackup(filePath: string): boolean {
  const bakPath = `${filePath}.bak`;
  if (!fs.existsSync(bakPath)) return false;
  try {
    fs.renameSync(bakPath, filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      fs.copyFileSync(bakPath, filePath);
      fs.unlinkSync(bakPath);
    } else {
      throw err;
    }
  }
  return true;
}

export function readExistingConfig(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_SIZE) return null;
    return content;
  } catch {
    return null;
  }
}

export function backupFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  fs.copyFileSync(filePath, `${filePath}.bak`);
}
