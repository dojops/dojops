import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFileSync, backupFile } from "@dojops/sdk";
import { RemediationPlan, PatchResult } from "../types";

export function applyFixes(plan: RemediationPlan, projectPath: string): PatchResult {
  const filesModified: string[] = [];
  const errors: string[] = [];

  for (const fix of plan.fixes) {
    const filePath = path.resolve(projectPath, fix.file);

    try {
      // Safety: only modify files within the project directory
      if (!filePath.startsWith(path.resolve(projectPath) + path.sep)) {
        errors.push(`${fix.findingId}: Path traversal blocked — ${fix.file}`);
        continue;
      }

      if (!fs.existsSync(filePath)) {
        errors.push(`${fix.findingId}: File not found — ${fix.file}`);
        continue;
      }

      // Create backup before any modification
      backupFile(filePath);

      const content = fs.readFileSync(filePath, "utf-8");

      switch (fix.action) {
        case "replace": {
          // Patch contains "old>>>new" format
          const parts = fix.patch.split(">>>");
          if (parts.length === 2) {
            const [oldStr, newStr] = parts;
            if (content.includes(oldStr)) {
              atomicWriteFileSync(filePath, content.replaceAll(oldStr, newStr));
              filesModified.push(fix.file);
            } else {
              errors.push(`${fix.findingId}: Pattern not found in ${fix.file}`);
            }
          } else {
            errors.push(`${fix.findingId}: Invalid replace patch format`);
          }
          break;
        }

        case "update-version": {
          // For package.json dependency version bumps
          if (fix.file === "package.json") {
            try {
              const pkg = JSON.parse(content);
              const [depName, newVersion] = fix.patch.split("@");
              if (depName && newVersion) {
                for (const section of ["dependencies", "devDependencies"]) {
                  if (pkg[section]?.[depName]) {
                    pkg[section][depName] = newVersion;
                  }
                }
                atomicWriteFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n");
                filesModified.push(fix.file);
              }
            } catch {
              errors.push(`${fix.findingId}: Failed to parse ${fix.file}`);
            }
          } else if (fix.file === "requirements.txt") {
            // For requirements.txt: replace version pin
            const [pkgName, newVersion] = fix.patch.split(">=");
            if (pkgName && newVersion) {
              const updated = content.replace(
                new RegExp(`^${escapeRegex(pkgName.trim())}[><=!~].+$`, "m"),
                `${pkgName.trim()}>=${newVersion}`,
              );
              atomicWriteFileSync(filePath, updated);
              filesModified.push(fix.file);
            }
          }
          break;
        }

        case "write": {
          // Overwrite file with patch content
          atomicWriteFileSync(filePath, fix.patch);
          filesModified.push(fix.file);
          break;
        }

        default:
          errors.push(`${fix.findingId}: Unknown action — ${fix.action}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${fix.findingId}: ${msg}`);
    }
  }

  return { filesModified: [...new Set(filesModified)], errors };
}

function escapeRegex(str: string): string {
  return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
