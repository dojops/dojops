import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFileSync, backupFile } from "@dojops/sdk";
import { RemediationPlan, PatchResult } from "../types";

interface FixContext {
  filePath: string;
  content: string;
  file: string;
  findingId: string;
  patch: string;
}

function applyReplace(ctx: FixContext, filesModified: string[], errors: string[]): void {
  const parts = ctx.patch.split(">>>");
  if (parts.length !== 2) {
    errors.push(`${ctx.findingId}: Invalid replace patch format`);
    return;
  }
  const [oldStr, newStr] = parts;
  if (!ctx.content.includes(oldStr)) {
    errors.push(`${ctx.findingId}: Pattern not found in ${ctx.file}`);
    return;
  }
  atomicWriteFileSync(ctx.filePath, ctx.content.replaceAll(oldStr, newStr));
  filesModified.push(ctx.file);
}

function applyUpdateVersionPackageJson(
  ctx: FixContext,
  filesModified: string[],
  errors: string[],
): void {
  try {
    const pkg = JSON.parse(ctx.content);
    const [depName, newVersion] = ctx.patch.split("@");
    if (!depName || !newVersion) return;
    for (const section of ["dependencies", "devDependencies"]) {
      if (pkg[section]?.[depName]) {
        pkg[section][depName] = newVersion;
      }
    }
    atomicWriteFileSync(ctx.filePath, JSON.stringify(pkg, null, 2) + "\n");
    filesModified.push(ctx.file);
  } catch {
    errors.push(`${ctx.findingId}: Failed to parse ${ctx.file}`);
  }
}

function applyUpdateVersionRequirements(ctx: FixContext, filesModified: string[]): void {
  const [pkgName, newVersion] = ctx.patch.split(">=");
  if (!pkgName || !newVersion) return;
  const trimmed = pkgName.trim();
  const lines = ctx.content.split("\n");
  const idx = lines.findIndex(
    (line) => line.startsWith(trimmed) && /[><=!~]/.test(line[trimmed.length] ?? ""),
  );
  if (idx >= 0) lines[idx] = `${trimmed}>=${newVersion}`;
  atomicWriteFileSync(ctx.filePath, idx >= 0 ? lines.join("\n") : ctx.content);
  filesModified.push(ctx.file);
}

function applyUpdateVersion(ctx: FixContext, filesModified: string[], errors: string[]): void {
  if (ctx.file === "package.json") {
    applyUpdateVersionPackageJson(ctx, filesModified, errors);
  } else if (ctx.file === "requirements.txt") {
    applyUpdateVersionRequirements(ctx, filesModified);
  }
}

function applySingleFix(
  fix: RemediationPlan["fixes"][number],
  projectPath: string,
  filesModified: string[],
  errors: string[],
): void {
  const filePath = path.resolve(projectPath, fix.file);

  if (!filePath.startsWith(path.resolve(projectPath) + path.sep)) {
    errors.push(`${fix.findingId}: Path traversal blocked — ${fix.file}`);
    return;
  }

  if (!fs.existsSync(filePath)) {
    errors.push(`${fix.findingId}: File not found — ${fix.file}`);
    return;
  }

  backupFile(filePath);
  const content = fs.readFileSync(filePath, "utf-8");
  const ctx: FixContext = {
    filePath,
    content,
    file: fix.file,
    findingId: fix.findingId,
    patch: fix.patch,
  };

  switch (fix.action) {
    case "replace":
      applyReplace(ctx, filesModified, errors);
      break;
    case "update-version":
      applyUpdateVersion(ctx, filesModified, errors);
      break;
    case "write":
      atomicWriteFileSync(filePath, fix.patch);
      filesModified.push(fix.file);
      break;
    default:
      errors.push(`${fix.findingId}: Unknown action — ${fix.action}`);
  }
}

export function applyFixes(plan: RemediationPlan, projectPath: string): PatchResult {
  const filesModified: string[] = [];
  const errors: string[] = [];

  for (const fix of plan.fixes) {
    try {
      applySingleFix(fix, projectPath, filesModified, errors);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${fix.findingId}: ${msg}`);
    }
  }

  return { filesModified: [...new Set(filesModified)], errors };
}
