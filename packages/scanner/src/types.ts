import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────

export type ScanSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ScanCategory = "SECURITY" | "DEPENDENCY" | "IAC" | "SECRETS";
export type ScanType = "all" | "security" | "deps" | "iac" | "sbom";

// ── Finding ────────────────────────────────────────────────────────

export interface ScanFinding {
  id: string;
  tool: string;
  severity: ScanSeverity;
  category: ScanCategory;
  file?: string;
  line?: number;
  message: string;
  recommendation?: string;
  autoFixAvailable: boolean;
}

// ── Report ─────────────────────────────────────────────────────────

export interface ScanReport {
  id: string;
  projectPath: string;
  timestamp: string;
  scanType: ScanType;
  findings: ScanFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  scannersRun: string[];
  scannersSkipped: string[];
  durationMs: number;
  sbomOutputs?: string[];
}

// ── Scanner result ─────────────────────────────────────────────────

export interface ScannerResult {
  tool: string;
  findings: ScanFinding[];
  rawOutput?: string;
  sbomOutput?: string;
  skipped?: boolean;
  skipReason?: string;
}

// ── Remediation ────────────────────────────────────────────────────

export interface RemediationFix {
  findingId: string;
  action: string;
  file: string;
  patch: string;
  description: string;
}

export interface RemediationPlan {
  fixes: RemediationFix[];
}

export interface PatchResult {
  filesModified: string[];
  errors: string[];
}

// ── Zod schemas (for LLM structured output) ────────────────────────

export const RemediationFixSchema = z.object({
  findingId: z.string(),
  action: z.string(),
  file: z.string(),
  patch: z.string(),
  description: z.string(),
});

export const RemediationPlanSchema = z.object({
  fixes: z.array(RemediationFixSchema),
});
