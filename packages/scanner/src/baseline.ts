import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface BaselineEntry {
  /** Fingerprint: hash of scanner + ruleId + file + message */
  fingerprint: string;
  scanner: string;
  ruleId: string;
  file: string;
  severity: string;
  message: string;
  /** ISO timestamp when this finding was baselined */
  baselinedAt: string;
  /** Optional reason for accepting this finding */
  reason?: string;
}

export interface ScanBaseline {
  version: 1;
  updatedAt: string;
  entries: BaselineEntry[];
}

/** Compute a stable fingerprint for a scan finding. */
export function findingFingerprint(
  scanner: string,
  ruleId: string,
  file: string,
  message: string,
): string {
  const data = `${scanner}|${ruleId}|${file}|${message}`;
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/** Load scan baseline from .dojops/scan-baseline.json. */
export function loadBaseline(projectPath: string): ScanBaseline | null {
  const filePath = path.join(projectPath, ".dojops", "scan-baseline.json");
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);
    if (data.version !== 1) return null;
    return data as ScanBaseline;
  } catch {
    return null;
  }
}

/** Save scan baseline to .dojops/scan-baseline.json. */
export function saveBaseline(projectPath: string, baseline: ScanBaseline): void {
  const dir = path.join(projectPath, ".dojops");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "scan-baseline.json");
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2) + "\n");
}

/** Filter findings against baseline, returning only new findings. */
export function filterBaselined(
  findings: Array<{
    scanner: string;
    ruleId?: string;
    file?: string;
    message: string;
    [key: string]: unknown;
  }>,
  baseline: ScanBaseline,
): Array<{
  scanner: string;
  ruleId?: string;
  file?: string;
  message: string;
  [key: string]: unknown;
}> {
  const baselinedFingerprints = new Set(baseline.entries.map((e) => e.fingerprint));
  return findings.filter((f) => {
    const fp = findingFingerprint(f.scanner, f.ruleId ?? "", f.file ?? "", f.message);
    return !baselinedFingerprints.has(fp);
  });
}

/** Create baseline entries from current findings. */
export function createBaselineFromFindings(
  findings: Array<{
    scanner: string;
    ruleId?: string;
    file?: string;
    severity?: string;
    message: string;
  }>,
): ScanBaseline {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    entries: findings.map((f) => ({
      fingerprint: findingFingerprint(f.scanner, f.ruleId ?? "", f.file ?? "", f.message),
      scanner: f.scanner,
      ruleId: f.ruleId ?? "",
      file: f.file ?? "",
      severity: f.severity ?? "unknown",
      message: f.message,
      baselinedAt: now,
    })),
  };
}
