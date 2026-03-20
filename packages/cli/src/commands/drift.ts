import { execFileSync } from "node:child_process";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { hasFlag, extractFlagValue } from "../parser";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { findProjectRoot, appendAudit, getCurrentUser } from "../state";

interface DriftedResource {
  type: string;
  name: string;
  changeType: "create" | "update" | "delete" | "replace" | "unknown";
  details?: string;
  source: "terraform" | "kubernetes";
}

interface DriftReport {
  source: string;
  driftDetected: boolean;
  resources: DriftedResource[];
  summary: {
    total: number;
    create: number;
    update: number;
    delete: number;
    replace: number;
  };
  rawOutput?: string;
}

// ── Terraform drift detection ─────────────────────────────────────

interface TfResourceChange {
  address: string;
  type: string;
  change: {
    actions: string[];
  };
}

interface TfPlanJson {
  resource_changes?: TfResourceChange[];
}

function detectTerraformDrift(): DriftReport {
  try {
    const result = execFileSync(
      "terraform",
      ["plan", "-json", "-detailed-exitcode", "-no-color", "-input=false"],
      { stdio: "pipe", timeout: 300_000 },
    );
    return parseTerraformPlanJson(result.toString("utf-8"));
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    // Exit code 2 means changes detected (drift found)
    if (execErr.status === 2 && execErr.stdout) {
      return parseTerraformPlanJson(execErr.stdout.toString("utf-8"));
    }
    // Exit code 0 means no changes
    if (execErr.status === 0) {
      return {
        source: "terraform",
        driftDetected: false,
        resources: [],
        summary: { total: 0, create: 0, update: 0, delete: 0, replace: 0 },
      };
    }
    const stderr = execErr.stderr?.toString("utf-8") ?? "";
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `Terraform plan failed: ${stderr || toErrorMessage(err)}`,
    );
  }
}

function resolveChangeType(actions: string[]): DriftedResource["changeType"] {
  if (actions.includes("create") && actions.includes("delete")) return "replace";
  if (actions.includes("create")) return "create";
  if (actions.includes("update")) return "update";
  if (actions.includes("delete")) return "delete";
  return "unknown";
}

function buildDriftSummary(resources: DriftedResource[]): DriftReport["summary"] {
  return {
    total: resources.length,
    create: resources.filter((r) => r.changeType === "create").length,
    update: resources.filter((r) => r.changeType === "update").length,
    delete: resources.filter((r) => r.changeType === "delete").length,
    replace: resources.filter((r) => r.changeType === "replace").length,
  };
}

function extractPlanData(jsonOutput: string): TfPlanJson | undefined {
  const lines = jsonOutput.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.resource_changes) return obj as unknown as TfPlanJson;
    } catch {
      // skip non-JSON lines
    }
  }
  return undefined;
}

function parseTerraformPlanJson(jsonOutput: string): DriftReport {
  const resources: DriftedResource[] = [];
  const planData = extractPlanData(jsonOutput);

  if (planData?.resource_changes) {
    for (const rc of planData.resource_changes) {
      const actions = rc.change.actions;
      if (actions.length === 1 && actions[0] === "no-op") continue;

      resources.push({
        type: rc.type,
        name: rc.address,
        changeType: resolveChangeType(actions),
        source: "terraform",
      });
    }
  }

  return {
    source: "terraform",
    driftDetected: resources.length > 0,
    resources,
    summary: buildDriftSummary(resources),
  };
}

// ── Kubernetes drift detection ────────────────────────────────────

function emptyDriftReport(source: "terraform" | "kubernetes"): DriftReport {
  return {
    source,
    driftDetected: false,
    resources: [],
    summary: { total: 0, create: 0, update: 0, delete: 0, replace: 0 },
  };
}

function parseKubeDiffResources(diffOutput: string, target: string): DriftedResource[] {
  const resources: DriftedResource[] = [];
  const diffLines = diffOutput.split("\n");

  for (const line of diffLines) {
    if (!line.startsWith("diff -u")) continue;
    const match = line.match(/\/([^/]+)\/([^/]+)$/);
    if (match) {
      resources.push({
        type: match[1] || "Resource",
        name: match[2] || "unknown",
        changeType: "update",
        source: "kubernetes",
        details: "Configuration differs from live state",
      });
    }
  }

  if (resources.length === 0 && diffOutput.trim()) {
    resources.push({
      type: "Resource",
      name: target,
      changeType: "update",
      source: "kubernetes",
      details: "Configuration drift detected",
    });
  }

  return resources;
}

function detectKubernetesDrift(manifestPath = "."): DriftReport {
  try {
    execFileSync("kubectl", ["diff", "-f", manifestPath], {
      stdio: "pipe",
      timeout: 60_000,
    });
    return emptyDriftReport("kubernetes");
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: Buffer; stderr?: Buffer };

    if (execErr.status === 1 && execErr.stdout) {
      const diffOutput = execErr.stdout.toString("utf-8");
      const resources = parseKubeDiffResources(diffOutput, manifestPath);
      return {
        source: "kubernetes",
        driftDetected: true,
        resources,
        summary: buildDriftSummary(resources),
        rawOutput: diffOutput,
      };
    }

    const stderr = execErr.stderr?.toString("utf-8") ?? "";
    throw new CLIError(
      ExitCode.GENERAL_ERROR,
      `kubectl diff failed: ${stderr || toErrorMessage(err)}`,
    );
  }
}

// ── Display ───────────────────────────────────────────────────────

function changeTypeLabel(changeType: DriftedResource["changeType"]): string {
  switch (changeType) {
    case "create":
      return pc.green("CREATE ");
    case "update":
      return pc.yellow("UPDATE ");
    case "delete":
      return pc.red("DELETE ");
    case "replace":
      return pc.magenta("REPLACE");
    default:
      return pc.dim("UNKNOWN");
  }
}

function displayDriftReport(report: DriftReport): void {
  if (!report.driftDetected) {
    p.log.success(`No drift detected (${report.source}).`);
    return;
  }

  const lines: string[] = [];
  for (const resource of report.resources) {
    const label = changeTypeLabel(resource.changeType);
    lines.push(`  ${label}  ${resource.name}`);
    if (resource.details) {
      lines.push(`           ${pc.dim(resource.details)}`);
    }
  }

  p.note(lines.join("\n"), `Drift Detected: ${report.source} (${report.summary.total} resources)`);

  const parts: string[] = [];
  if (report.summary.create > 0) parts.push(pc.green(`${report.summary.create} create`));
  if (report.summary.update > 0) parts.push(pc.yellow(`${report.summary.update} update`));
  if (report.summary.delete > 0) parts.push(pc.red(`${report.summary.delete} delete`));
  if (report.summary.replace > 0) parts.push(pc.magenta(`${report.summary.replace} replace`));

  if (parts.length > 0) {
    p.log.warn(`Summary: ${parts.join(", ")}`);
  }
}

// ── Main command ──────────────────────────────────────────────────

function runDriftDetection(
  label: string,
  detect: () => DriftReport,
  isJson: boolean,
  suppressErrors: boolean,
): DriftReport | null {
  const spinner = p.spinner();
  if (!isJson) spinner.start(`Detecting ${label} drift...`);

  try {
    const report = detect();
    if (!isJson)
      spinner.stop(report.driftDetected ? `${label} drift detected` : `No ${label} drift`);
    return report;
  } catch (err) {
    if (!isJson) spinner.stop(`${label} drift detection failed`);
    if (suppressErrors) {
      p.log.warn(`${label}: ${toErrorMessage(err)}`);
      return null;
    }
    throw err;
  }
}

function outputDriftResults(reports: DriftReport[], isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
    return;
  }
  for (const report of reports) {
    displayDriftReport(report);
  }
}

function auditDriftCommand(reports: DriftReport[], startTime: number): void {
  const root = findProjectRoot();
  if (!root) return;

  const hasDrift = reports.some((r) => r.driftDetected);
  appendAudit(root, {
    timestamp: new Date().toISOString(),
    user: getCurrentUser(),
    command: "drift",
    action: "detect",
    status: hasDrift ? "drift-detected" : "no-drift",
    durationMs: Date.now() - startTime,
  });
}

export async function driftCommand(args: string[], ctx: CLIContext): Promise<void> {
  const startTime = Date.now();

  const useTerraform = hasFlag(args, "--terraform");
  const useKubernetes = hasFlag(args, "--kubernetes");
  const manifestPath = extractFlagValue(args, "--path");
  const detectBoth = !useTerraform && !useKubernetes;
  const isJson = ctx.globalOpts.output === "json";

  const reports: DriftReport[] = [];

  if (useTerraform || detectBoth) {
    const report = runDriftDetection("Terraform", detectTerraformDrift, isJson, detectBoth);
    if (report) reports.push(report);
  }

  if (useKubernetes || detectBoth) {
    const report = runDriftDetection(
      "Kubernetes",
      () => detectKubernetesDrift(manifestPath),
      isJson,
      detectBoth,
    );
    if (report) reports.push(report);
  }

  if (reports.length === 0 && detectBoth) {
    p.log.info("Neither Terraform nor Kubernetes detected. Use --terraform or --kubernetes.");
    return;
  }

  outputDriftResults(reports, isJson);
  auditDriftCommand(reports, startTime);
}
