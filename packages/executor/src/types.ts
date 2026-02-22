import { z } from "zod";
import type { VerificationResult } from "@odaops/sdk";

export const ExecutionPolicySchema = z.object({
  allowWrite: z.boolean().default(false),
  allowedWritePaths: z.array(z.string()).default([]),
  deniedWritePaths: z.array(z.string()).default([]),
  allowNetwork: z.boolean().default(false),
  allowEnvVars: z.array(z.string()).default([]),
  timeoutMs: z.number().positive().default(30_000),
  maxFileSizeBytes: z.number().positive().default(1_048_576),
  requireApproval: z.boolean().default(true),
  skipVerification: z.boolean().default(true),
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
  durationMs: number;
}
