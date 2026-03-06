import fs from "node:fs";
import path from "node:path";

function formatLanguageName(l: unknown): string {
  if (typeof l === "string") return l;
  if (
    l &&
    typeof l === "object" &&
    "name" in l &&
    typeof (l as { name?: string }).name === "string"
  ) {
    return (l as { name: string }).name;
  }
  return "unknown";
}

function formatLanguages(languages: unknown): string {
  if (!Array.isArray(languages)) return String(languages);
  return languages.map(formatLanguageName).join(", ");
}

export function buildSessionContext(rootDir: string): string {
  const parts: string[] = [];

  // Load repo context from dojops init
  const contextFile = path.join(rootDir, ".dojops", "context.json");
  if (fs.existsSync(contextFile)) {
    try {
      const ctx = JSON.parse(fs.readFileSync(contextFile, "utf-8"));
      parts.push("## Project Context");
      if (ctx.name) parts.push(`Project: ${ctx.name}`);
      if (ctx.languages?.length) {
        parts.push(`Languages: ${formatLanguages(ctx.languages)}`);
      }
      if (ctx.packageManagers?.length)
        parts.push(`Package managers: ${ctx.packageManagers.join(", ")}`);
      if (ctx.ciPlatforms?.length) parts.push(`CI/CD: ${ctx.ciPlatforms.join(", ")}`);
      if (ctx.infrastructure?.length)
        parts.push(`Infrastructure: ${ctx.infrastructure.join(", ")}`);
      if (ctx.containers?.length) parts.push(`Containers: ${ctx.containers.join(", ")}`);
      if (ctx.llmSummary) parts.push(`\nSummary: ${ctx.llmSummary}`);
    } catch {
      // Skip if corrupt
    }
  }

  // Load latest scan summary
  const scanDir = path.join(rootDir, ".dojops", "scan-history");
  if (fs.existsSync(scanDir)) {
    try {
      const files = fs
        .readdirSync(scanDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse();
      if (files.length > 0) {
        const latest = JSON.parse(fs.readFileSync(path.join(scanDir, files[0]), "utf-8"));
        if (typeof latest.summary === "string" && latest.summary.length <= 4096) {
          // Sanitize: strip control chars and bidi markers to prevent prompt injection
          const safeSummary = latest.summary.replaceAll(
            // NOSONAR - complex character class
            // eslint-disable-next-line no-control-regex
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
            "",
          );
          parts.push(`\n## Latest Security Scan`, safeSummary);
        }
      }
    } catch {
      // Skip
    }
  }

  // Load current session state
  const sessionFile = path.join(rootDir, ".dojops", "session.json");
  if (fs.existsSync(sessionFile)) {
    try {
      const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      if (session.currentPlan) {
        parts.push(`\n## Active Plan: ${session.currentPlan}`);
      }
      if (session.mode && session.mode !== "IDLE") {
        parts.push(`Current mode: ${session.mode}`);
      }
    } catch {
      // Skip
    }
  }

  return parts.length > 0 ? parts.join("\n") : "";
}
