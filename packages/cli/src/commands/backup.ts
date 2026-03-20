import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { findProjectRoot } from "../state";
import { ExitCode, CLIError } from "../exit-codes";
import { extractFlagValue } from "../parser";

function getRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Not inside a project. Run `dojops init` first.");
  }
  return root;
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function handleBackup(args: string[], ctx: CLIContext): void {
  const root = getRoot();
  const dojopsDir = path.join(root, ".dojops");

  if (!fs.existsSync(dojopsDir)) {
    throw new CLIError(
      ExitCode.VALIDATION_ERROR,
      "No .dojops/ directory found. Run `dojops init` first.",
    );
  }

  const outDir = extractFlagValue(args, "--output") ?? root;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archiveName = `dojops-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(outDir, archiveName);

  try {
    execFileSync("tar", ["czf", archivePath, "-C", root, ".dojops"], {
      timeout: 30_000,
      stdio: "pipe",
    });
  } catch (err) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const hash = sha256File(archivePath);
  const checksumPath = archivePath + ".sha256";
  fs.writeFileSync(checksumPath, `${hash}  ${archiveName}\n`);

  const stats = fs.statSync(archivePath);
  const sizeKB = Math.ceil(stats.size / 1024);

  if (ctx.globalOpts.output === "json") {
    console.log(
      JSON.stringify({
        archive: archivePath,
        checksum: checksumPath,
        sha256: hash,
        sizeBytes: stats.size,
      }),
    );
    return;
  }

  p.log.success(`Backup created: ${pc.cyan(archivePath)}`);
  p.log.info(`${pc.dim(`Size: ${sizeKB} KB  SHA-256: ${hash.slice(0, 16)}…`)}`);
  p.log.info(pc.dim(`Checksum: ${checksumPath}`));
}

function handleRestore(args: string[], ctx: CLIContext): void {
  const root = getRoot();
  const archivePath = args[0];

  if (!archivePath) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, "Usage: dojops backup restore <archive.tar.gz>");
  }

  const resolved = path.resolve(archivePath);
  if (!fs.existsSync(resolved)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `Archive not found: ${resolved}`);
  }

  // Verify checksum if .sha256 file exists alongside
  const checksumPath = resolved + ".sha256";
  if (fs.existsSync(checksumPath)) {
    const checksumContent = fs.readFileSync(checksumPath, "utf-8").trim();
    const expectedHash = checksumContent.split(/\s+/)[0];
    const actualHash = sha256File(resolved);
    if (expectedHash !== actualHash) {
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Checksum mismatch! Expected ${expectedHash.slice(0, 16)}…, got ${actualHash.slice(0, 16)}…`,
      );
    }
    if (!ctx.globalOpts.quiet) {
      p.log.info(pc.green("Checksum verified."));
    }
  }

  // Restore by extracting into the project root
  try {
    execFileSync("tar", ["xzf", resolved, "-C", root], {
      timeout: 30_000,
      stdio: "pipe",
    });
  } catch (err) {
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Restore failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify({ restored: true, from: resolved, to: root }));
    return;
  }

  p.log.success(`Restored .dojops/ from ${pc.cyan(path.basename(resolved))}`);
}

function handleList(ctx: CLIContext): void {
  const root = getRoot();
  const files = fs
    .readdirSync(root)
    .filter((f) => f.startsWith("dojops-backup-") && f.endsWith(".tar.gz"))
    .sort()
    .reverse();

  if (ctx.globalOpts.output === "json") {
    const entries = files.map((f) => {
      const fp = path.join(root, f);
      const stats = fs.statSync(fp);
      return { name: f, sizeBytes: stats.size, created: stats.mtime.toISOString() };
    });
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  if (files.length === 0) {
    p.log.info("No backups found. Use `dojops backup` to create one.");
    return;
  }

  const lines = files.map((f) => {
    const fp = path.join(root, f);
    const stats = fs.statSync(fp);
    const sizeKB = Math.ceil(stats.size / 1024);
    return `  ${pc.cyan(f)}  ${pc.dim(`${sizeKB} KB`)}`;
  });
  p.note(lines.join("\n"), `Backups (${files.length})`);
}

export async function backupCommand(args: string[], ctx: CLIContext): Promise<void> {
  const sub = args[0];

  if (sub === "restore") {
    handleRestore(args.slice(1), ctx);
    return;
  }

  if (sub === "list") {
    handleList(ctx);
    return;
  }

  // Default: create backup. If sub looks like a flag, pass it through.
  const backupArgs = sub && sub.startsWith("-") ? args : args.slice(sub ? 0 : 0);
  handleBackup(backupArgs, ctx);
}
