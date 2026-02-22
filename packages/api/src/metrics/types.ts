export interface OverviewMetrics {
  totalPlans: number;
  totalExecutions: number;
  successRate: number;
  avgExecutionTimeMs: number;
  totalScans: number;
  totalFindings: number;
  criticalFindings: number;
  highFindings: number;
  mostUsedAgents: Array<{ agent: string; count: number }>;
  failureReasons: Array<{ reason: string; count: number }>;
  recentActivity: Array<{
    timestamp: string;
    action: string;
    status: string;
    planId?: string;
  }>;
}

export interface SecurityMetrics {
  totalScans: number;
  totalFindings: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byCategory: { security: number; dependency: number; iac: number; secrets: number };
  findingsTrend: Array<{
    date: string;
    critical: number;
    high: number;
    medium: number;
    low: number;
  }>;
  topIssues: Array<{ message: string; severity: string; count: number; tool: string }>;
  scanHistory: Array<{
    id: string;
    timestamp: string;
    total: number;
    critical: number;
    high: number;
    durationMs: number;
  }>;
}

export interface AuditEntry {
  timestamp: string;
  user: string;
  command: string;
  action: string;
  planId?: string;
  status: "success" | "failure" | "cancelled";
  durationMs: number;
  seq?: number;
  hash?: string;
  previousHash?: string;
}

export interface AuditMetrics {
  totalEntries: number;
  chainIntegrity: { valid: boolean; errors: number; totalEntries: number };
  byStatus: { success: number; failure: number; cancelled: number };
  byCommand: Array<{ command: string; count: number }>;
  timeline: Array<{
    timestamp: string;
    command: string;
    action: string;
    status: string;
    planId?: string;
  }>;
  recentEntries: AuditEntry[];
}

export interface DashboardMetrics {
  overview: OverviewMetrics;
  security: SecurityMetrics;
  audit: AuditMetrics;
  generatedAt: string;
}
