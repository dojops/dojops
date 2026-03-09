import { z } from "zod";
import type { VerificationResult } from "@dojops/sdk";

/** Task risk classification levels, ordered from lowest to highest. */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Numeric ordering for risk comparison. */
export const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/** Returns true if `taskRisk` is at or below the `threshold`. */
export function isRiskAtOrBelow(taskRisk: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_ORDER[taskRisk] <= RISK_ORDER[threshold];
}

// ── File path risk classification ─────────────────────────────────

const CRITICAL_PATH_PATTERNS = [
  /^~?\/?\.ssh\//, // SSH keys
  /^~?\/?\.gnupg\//, // GPG keys
  /^\/etc\/shadow/, // System passwords
  /^\/etc\/passwd/, // System users
  /^\/etc\/sudoers/, // Sudo config
  /private[_-]?key/i, // Private key files
  /\.pem$/, // Certificate files
  /id_rsa/, // SSH private keys
];

const HIGH_PATH_PATTERNS = [
  /\.env$/, // Environment files
  /\.env\./, // .env.local, .env.production
  /credentials/i, // Credential files
  /^\/etc\//, // System config
  /kubeconfig/i, // Kubernetes config
  /\.kube\//, // Kubernetes directory
  /terraform\.tfstate/, // Terraform state
  /\.tfvars$/, // Terraform variables
];

/** Classify risk based on file output path. */
export function classifyPathRisk(filePath: string): RiskLevel {
  if (CRITICAL_PATH_PATTERNS.some((p) => p.test(filePath))) {
    return "CRITICAL";
  }
  if (HIGH_PATH_PATTERNS.some((p) => p.test(filePath))) {
    return "HIGH";
  }
  return "LOW";
}

export const ExecutionPolicySchema = z.object({
  allowWrite: z.boolean().default(false),
  allowedWritePaths: z.array(z.string()).default([]),
  deniedWritePaths: z.array(z.string()).default([]),
  enforceDevOpsAllowlist: z.boolean().default(true),
  /** @advisory NOT enforced at runtime. Tool code has full network access. Reserved for future OS-level sandboxing. */
  allowNetwork: z.boolean().default(false),
  /** @advisory NOT enforced at runtime. Tool code has full env access. Use `filterEnvVars(policy)` to apply manually. */
  allowEnvVars: z.array(z.string()).default([]),
  timeoutMs: z.number().positive().default(30_000),
  generateTimeoutMs: z.number().positive().optional(),
  verifyTimeoutMs: z.number().positive().optional(),
  executeTimeoutMs: z.number().positive().optional(),
  maxFileSizeBytes: z.number().positive().default(1_048_576),
  requireApproval: z.boolean().default(false),
  skipVerification: z.boolean().default(false),
  /** Max times to re-generate when verification finds errors (0 = no retries). */
  maxVerifyRetries: z.number().nonnegative().default(1),
  /** Approval mode: "always" requires human approval, "risk-based" auto-approves low-risk tasks, "never" skips approval. */
  approvalMode: z.enum(["always", "risk-based", "never"]).default("always"),
  /** When approvalMode is "risk-based", tasks at or below this risk level are auto-approved. */
  autoApproveRiskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  /** Max repair attempts when verification fails (critic + re-generate cycle). */
  maxRepairAttempts: z.number().nonnegative().default(3),
});

export type ExecutionPolicy = z.infer<typeof ExecutionPolicySchema>;

export type ApprovalDecision = "approved" | "denied" | "skipped";

export interface ApprovalRequest {
  taskId: string;
  toolName: string;
  description: string;
  preview: ExecutionPreview;
}

export interface ExecutionPreview {
  filesCreated: string[];
  filesModified: string[];
  summary: string;
}

export interface ExecutionResult {
  taskId: string;
  status: "completed" | "denied" | "failed" | "timeout";
  approval?: ApprovalDecision;
  output?: unknown;
  error?: string;
  verification?: VerificationResult;
  durationMs: number;
  auditLog: ExecutionAuditEntry;
}

export interface ExecutionAuditEntry {
  taskId: string;
  toolName: string;
  timestamp: string;
  policy: ExecutionPolicy;
  approval: ApprovalDecision;
  status: ExecutionResult["status"];
  error?: string;
  verification?: VerificationResult;
  filesWritten: string[];
  filesModified: string[];
  filesUnchanged?: string[];
  durationMs: number;
  toolType?: "built-in" | "custom";
  toolSource?: "global" | "project";
  toolVersion?: string;
  toolHash?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
