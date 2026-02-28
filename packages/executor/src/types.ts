import { z } from "zod";
import type { VerificationResult } from "@dojops/sdk";

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
  auditLog: AuditEntry;
}

export interface AuditEntry {
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
  durationMs: number;
  toolType?: "built-in" | "custom";
  toolSource?: "global" | "project";
  toolVersion?: string;
  toolHash?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}
