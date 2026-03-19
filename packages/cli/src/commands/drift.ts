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

function parseTerraformPlanJson(jsonOutput: string): DriftReport {
  const resources: DriftedResource[] = [];

  // terraform plan -json outputs multiple JSON objects, one per line
  const lines = jsonOutput.split("\n").filter((l) => l.trim());
  let planData: TfPlanJson | undefined;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.resource_changes) {
        planData = obj as unknown as TfPlanJson;
        break;
      }
    } catch {
      // skip non-JSON lines
    }
  }

  if (planData?.resource_changes) {
    for (const rc of planData.resource_changes) {
      const actions = rc.change.actions;
      if (actions.length === 1 && actions[0] === "no-op") continue;

      let changeType: DriftedResource["changeType"] = "unknown";
      if (actions.includes("create") && actions.includes("delete")) changeType = "replace";
      else if (actions.includes("create")) changeType = "create";
      else if (actions.includes("update")) changeType = "update";
      else if (actions.includes("delete")) changeType = "delete";

      resources.push({
        type: rc.type,
        name: rc.address,
        changeType,
        source: "terraform",
      });
    }
  }

  const summary = {
    total: resources.length,
    create: resources.filter((r) => r.changeType === "create").length,
    update: resources.filter((r) => r.changeType === "update").length,
    delete: resources.filter((r) => r.changeType === "delete").length,
    replace: resources.filter((r) => r.changeType === "replace").length,
  };

  return {
    source: "terraform",
    driftDetected: resources.length > 0,
    resources,
    summary,
  };
}

// ── Kubernetes drift detection ────────────────────────────────────

function detectKubernetesDrift(manifestPath?: string): DriftReport {
  const target = manifestPath || ".";
  const resources: DriftedResource[] = [];

  try {
    execFileSync("kubectl", ["diff", "-f", target], {
      stdio: "pipe",
      timeout: 60_000,
    });
    // Exit code 0: no diff
    return {
      source: "kubernetes",
      driftDetected: false,
      resources: [],
      summary: { total: 0, create: 0, update: 0, delete: 0, replace: 0 },
    };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    // Exit code 1 means differences found
    if (execErr.status === 1 && execErr.stdout) {
      const diffOutput = execErr.stdout.toString("utf-8");
      const diffLines = diffOutput.split("\n");

      // Parse unified diff headers to extract resource names
      for (const line of diffLines) {
        if (line.startsWith("diff -u")) {
          // Extract resource info from the diff header
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
      }

      // If no resources parsed from diff headers, create a generic entry
      if (resources.length === 0 && diffOutput.trim()) {
        resources.push({
          type: "Resource",
          name: target,
          changeType: "update",
          source: "kubernetes",
          details: "Configuration drift detected",
        });
      }

      const summary = {
        total: resources.length,
        create: resources.filter((r) => r.changeType === "create").length,
        update: resources.filter((r) => r.changeType === "update").length,
        delete: resources.filter((r) => r.changeType === "delete").length,
        replace: resources.filter((r) => r.changeType === "replace").length,
      };

      return {
        source: "kubernetes",
        driftDetected: true,
        resources,
        summary,
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

export async function driftCommand(args: string[], ctx: CLIContext): Promise<void> {
  const startTime = Date.now();

  const useTerraform = hasFlag(args, "--terraform");
  const useKubernetes = hasFlag(args, "--kubernetes");
  const manifestPath = extractFlagValue(args, "--path");
  const detectBoth = !useTerraform && !useKubernetes;

  const reports: DriftReport[] = [];

  if (useTerraform || detectBoth) {
    const isStructuredOutput = ctx.globalOpts.output === "json";
    const spinner = p.spinner();
    if (!isStructuredOutput) spinner.start("Detecting Terraform drift...");
    try {
      const report = detectTerraformDrift();
      if (!isStructuredOutput)
        spinner.stop(report.driftDetected ? "Terraform drift detected" : "No Terraform drift");
      reports.push(report);
    } catch (err) {
      if (!isStructuredOutput) spinner.stop("Terraform drift detection failed");
      if (detectBoth) {
        p.log.warn(`Terraform: ${toErrorMessage(err)}`);
      } else {
        throw err;
      }
    }
  }

  if (useKubernetes || detectBoth) {
    const isStructuredOutput = ctx.globalOpts.output === "json";
    const spinner = p.spinner();
    if (!isStructuredOutput) spinner.start("Detecting Kubernetes drift...");
    try {
      const report = detectKubernetesDrift(manifestPath);
      if (!isStructuredOutput)
        spinner.stop(report.driftDetected ? "Kubernetes drift detected" : "No Kubernetes drift");
      reports.push(report);
    } catch (err) {
      if (!isStructuredOutput) spinner.stop("Kubernetes drift detection failed");
      if (detectBoth) {
        p.log.warn(`Kubernetes: ${toErrorMessage(err)}`);
      } else {
        throw err;
      }
    }
  }

  if (reports.length === 0 && detectBoth) {
    p.log.info("Neither Terraform nor Kubernetes detected. Use --terraform or --kubernetes.");
    return;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else {
    for (const report of reports) {
      displayDriftReport(report);
    }
  }

  const root = findProjectRoot();
  if (root) {
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
}
