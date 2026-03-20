import { execFileSync } from "node:child_process";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import { CLIContext } from "../types";
import { ExitCode, CLIError, toErrorMessage } from "../exit-codes";
import { findProjectRoot, appendAudit, getCurrentUser } from "../state";

interface InfracostResource {
  name: string;
  resourceType?: string;
  monthlyCost?: string;
  hourlyCost?: string;
  metadata?: Record<string, unknown>;
  subresources?: InfracostResource[];
}

interface InfracostProject {
  name: string;
  path: string;
  currency: string;
  totalMonthlyCost: string;
  totalHourlyCost: string;
  pastTotalMonthlyCost?: string;
  diffTotalMonthlyCost?: string;
  resources: InfracostResource[];
}

interface InfracostOutput {
  version: string;
  currency: string;
  projects: InfracostProject[];
  totalMonthlyCost: string;
  totalHourlyCost: string;
  pastTotalMonthlyCost?: string;
  diffTotalMonthlyCost?: string;
  timeGenerated: string;
}

function isInfracostInstalled(): boolean {
  try {
    execFileSync("infracost", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function runInfracost(targetPath: string): InfracostOutput {
  try {
    const result = execFileSync(
      "infracost",
      ["breakdown", "--path", targetPath, "--format", "json"],
      { stdio: "pipe", timeout: 120_000 },
    );
    return JSON.parse(result.toString("utf-8")) as InfracostOutput;
  } catch (err) {
    throw new CLIError(ExitCode.GENERAL_ERROR, `Infracost failed: ${toErrorMessage(err)}`);
  }
}

function formatCurrency(amount: string | undefined, currency: string): string {
  if (!amount || amount === "0") return pc.dim("$0.00");
  const num = parseFloat(amount);
  if (isNaN(num)) return pc.dim("$0.00");
  const symbol = currency === "USD" ? "$" : currency;
  return `${symbol}${num.toFixed(2)}`;
}

function buildResourceTable(resources: InfracostResource[], currency: string): string[] {
  const lines: string[] = [];
  lines.push(`  ${pc.bold("Resource".padEnd(40))} ${pc.bold("Monthly Cost".padStart(14))}`);
  lines.push(`  ${"─".repeat(40)} ${"─".repeat(14)}`);

  for (const resource of resources) {
    const cost = formatCurrency(resource.monthlyCost, currency);
    lines.push(`  ${resource.name.padEnd(40)} ${cost.padStart(14)}`);

    if (resource.subresources) {
      for (const sub of resource.subresources) {
        const subCost = formatCurrency(sub.monthlyCost, currency);
        lines.push(`    ${pc.dim(sub.name.padEnd(38))} ${subCost.padStart(14)}`);
      }
    }
  }

  lines.push(`  ${"─".repeat(40)} ${"─".repeat(14)}`);
  return lines;
}

function buildCostDiffLine(diffAmount: string, currency: string): string | null {
  if (!diffAmount || diffAmount === "0") return null;
  const diff = parseFloat(diffAmount);
  const diffLabel =
    diff > 0
      ? pc.red(`+${formatCurrency(diffAmount, currency)}`)
      : pc.green(formatCurrency(diffAmount, currency));
  return `  ${pc.bold("Monthly Cost Change".padEnd(40))} ${diffLabel.padStart(14)}`;
}

function displayCostSummary(data: InfracostOutput): void {
  const currency = data.currency || "USD";

  for (const project of data.projects) {
    const lines: string[] = [];
    lines.push(`${pc.bold("Path:")}     ${project.path}`);
    lines.push(`${pc.bold("Currency:")} ${currency}`);
    lines.push("");

    if (project.resources.length > 0) {
      lines.push(...buildResourceTable(project.resources, currency));
    }

    const totalMonthly = formatCurrency(project.totalMonthlyCost, currency);
    lines.push(
      `  ${pc.bold("Total Monthly Cost".padEnd(40))} ${pc.bold(totalMonthly.padStart(14))}`,
    );

    const diffLine = buildCostDiffLine(project.diffTotalMonthlyCost || "", currency);
    if (diffLine) lines.push(diffLine);

    p.note(lines.join("\n"), `Cost Estimate: ${project.name || project.path}`);
  }

  if (data.projects.length > 1) {
    const total = formatCurrency(data.totalMonthlyCost, currency);
    p.log.info(`${pc.bold("Grand Total:")} ${total}/month`);
  }
}

export async function costCommand(args: string[], ctx: CLIContext): Promise<void> {
  const startTime = Date.now();

  if (!isInfracostInstalled()) {
    p.note(
      [
        `${pc.bold(pc.yellow("Infracost is not installed."))}`,
        "",
        "Install infracost to enable cost estimation:",
        `  ${pc.cyan("brew install infracost")}`,
        `  ${pc.cyan("curl -fsSL https://raw.githubusercontent.com/infracost/infracost/master/scripts/install.sh | sh")}`,
        "",
        `Then configure your API key:`,
        `  ${pc.cyan("infracost auth login")}`,
        "",
        `More info: ${pc.dim("https://www.infracost.io/docs/")}`,
      ].join("\n"),
      "Install Required",
    );
    throw new CLIError(ExitCode.GENERAL_ERROR, "Infracost is not installed.");
  }

  const targetPath = args.find((a) => !a.startsWith("-")) || ".";
  const resolvedPath = path.resolve(targetPath);

  const isStructuredOutput = ctx.globalOpts.output === "json" || ctx.globalOpts.output === "yaml";
  const spinner = p.spinner();
  if (!isStructuredOutput) spinner.start(`Estimating costs for ${pc.dim(resolvedPath)}...`);

  let data: InfracostOutput;
  try {
    data = runInfracost(resolvedPath);
    if (!isStructuredOutput) spinner.stop("Cost estimation complete");
  } catch (err) {
    if (!isStructuredOutput) spinner.stop("Cost estimation failed");
    throw err;
  }

  if (ctx.globalOpts.output === "json") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    displayCostSummary(data);
  }

  const root = findProjectRoot();
  if (root) {
    appendAudit(root, {
      timestamp: new Date().toISOString(),
      user: getCurrentUser(),
      command: "cost",
      action: "estimate",
      status: "success",
      durationMs: Date.now() - startTime,
    });
  }
}
