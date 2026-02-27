import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import * as p from "@clack/prompts";
import * as yaml from "js-yaml";
import { verifyWithBinary } from "@dojops/runtime";
import { CLIContext } from "../types";
import { ExitCode, CLIError } from "../exit-codes";

/** Matches VerificationResult from @dojops/sdk (CLI does not depend on SDK directly). */
interface VerificationResult {
  passed: boolean;
  tool: string;
  issues: Array<{
    severity: "error" | "warning" | "info";
    message: string;
    line?: number;
    rule?: string;
  }>;
  rawOutput?: string;
}

/**
 * Detect file type from filename/extension and content, then run
 * the appropriate verifier.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyCommand(args: string[], _ctx?: CLIContext): Promise<void> {
  const filePath = args.find((a) => !a.startsWith("-"));
  if (!filePath) {
    p.log.info(`  ${pc.dim("$")} dojops verify <file>`);
    throw new CLIError(ExitCode.VALIDATION_ERROR, "File path required.");
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CLIError(ExitCode.VALIDATION_ERROR, `File not found: ${resolvedPath}`);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const basename = path.basename(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();

  const spinner = p.spinner();
  spinner.start(`Verifying ${pc.cyan(basename)}...`);

  let result: VerificationResult;

  try {
    if (ext === ".tf") {
      result = await verifyTerraformContent(content);
    } else if (basename === "Dockerfile" || basename.startsWith("Dockerfile.")) {
      result = await verifyWithBinary({
        content,
        filename: "Dockerfile",
        config: {
          command: "hadolint --format json Dockerfile",
          parser: "hadolint-json",
          timeout: 30_000,
          cwd: "output",
        },
        childProcessPermission: "required",
      });
    } else if (ext === ".yaml" || ext === ".yml") {
      result = await verifyYamlFile(content, basename);
    } else {
      spinner.stop("Unknown file type");
      throw new CLIError(
        ExitCode.VALIDATION_ERROR,
        `Cannot verify file type: ${ext || basename}. Supported: .tf, Dockerfile, .yaml/.yml`,
      );
    }
  } catch (err) {
    if (err instanceof CLIError) {
      throw err;
    }
    spinner.stop("Verification failed");
    throw new CLIError(ExitCode.GENERAL_ERROR, err instanceof Error ? err.message : String(err));
  }

  spinner.stop(`Verified with ${pc.cyan(result.tool)}`);

  // Display results
  if (result.passed) {
    p.log.success(`${pc.green("PASSED")} - ${result.tool}`);
  } else {
    p.log.error(`${pc.red("FAILED")} - ${result.tool}`);
  }

  if (result.issues.length > 0) {
    console.log();
    for (const issue of result.issues) {
      const label =
        issue.severity === "error"
          ? pc.red("ERROR")
          : issue.severity === "warning"
            ? pc.yellow("WARN ")
            : pc.dim("INFO ");
      const lineInfo = issue.line ? ` ${pc.dim(`line ${issue.line}`)}` : "";
      const ruleInfo = issue.rule ? ` ${pc.dim(`[${issue.rule}]`)}` : "";
      console.log(`  ${label}${lineInfo}${ruleInfo}  ${issue.message}`);
    }
    console.log();
  }

  if (!result.passed) {
    throw new CLIError(ExitCode.VALIDATION_ERROR);
  }
}

/**
 * Terraform requires init + validate in sequence (two-step process).
 * We handle this directly rather than via verifyWithBinary which runs a single command.
 */
async function verifyTerraformContent(hcl: string): Promise<VerificationResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-tf-"));

  try {
    fs.writeFileSync(path.join(tmpDir, "main.tf"), hcl, "utf-8");

    // Step 1: terraform init
    try {
      execFileSync("terraform", ["-chdir=" + tmpDir, "init", "-backend=false", "-input=false"], {
        encoding: "utf-8",
        timeout: 60_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          passed: true,
          tool: "terraform validate",
          issues: [{ severity: "warning", message: "terraform not found — skipped" }],
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        passed: false,
        tool: "terraform validate",
        issues: [{ severity: "error", message: `terraform init failed: ${msg}` }],
      };
    }

    // Step 2: terraform validate -json
    let rawOutput: string;
    try {
      rawOutput = execFileSync("terraform", ["-chdir=" + tmpDir, "validate", "-json"], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          passed: true,
          tool: "terraform validate",
          issues: [{ severity: "warning", message: "terraform not found — skipped" }],
        };
      }
      const execErr = err as { stdout?: string; stderr?: string };
      rawOutput = execErr.stdout ?? "";
      if (!rawOutput) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          passed: false,
          tool: "terraform validate",
          issues: [{ severity: "error", message: `terraform validate failed: ${msg}` }],
          rawOutput: execErr.stderr,
        };
      }
    }

    let parsed: {
      valid: boolean;
      diagnostics?: Array<{ severity: string; summary: string; detail?: string }>;
    };
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      return {
        passed: false,
        tool: "terraform validate",
        issues: [{ severity: "error", message: "Failed to parse terraform validate JSON output" }],
        rawOutput,
      };
    }

    const issues = (parsed.diagnostics ?? []).map((d) => ({
      severity: (d.severity === "error" ? "error" : "warning") as "error" | "warning",
      message: d.detail ? `${d.summary}: ${d.detail}` : d.summary,
    }));

    return { passed: parsed.valid, tool: "terraform validate", issues, rawOutput };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Helm requires building a chart directory structure for `helm lint`.
 */
async function verifyHelmContent(
  chartYaml: string,
  valuesYaml: string,
  templates: Record<string, string>,
): Promise<VerificationResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-helm-"));
  const chartDir = path.join(tmpDir, "chart");
  const templatesDir = path.join(chartDir, "templates");

  try {
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(chartDir, "Chart.yaml"), chartYaml, "utf-8");
    fs.writeFileSync(path.join(chartDir, "values.yaml"), valuesYaml, "utf-8");
    for (const [name, content] of Object.entries(templates)) {
      fs.writeFileSync(path.join(templatesDir, `${name}.yaml`), content, "utf-8");
    }

    try {
      const rawOutput = execFileSync("helm", ["lint", chartDir], {
        encoding: "utf-8",
        timeout: 30_000,
        stdio: "pipe",
      });

      return { passed: true, tool: "helm lint", issues: [], rawOutput };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          passed: true,
          tool: "helm lint",
          issues: [{ severity: "warning", message: "helm not found — skipped" }],
        };
      }

      const execErr = err as { stdout?: string; stderr?: string };
      const output = (execErr.stdout ?? "") + (execErr.stderr ?? "");
      const lines = output
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("[ERROR]") || l.startsWith("[WARNING]"));

      const issues = lines.map((line) => ({
        severity: (line.startsWith("[ERROR]") ? "error" : "warning") as "error" | "warning",
        message: line.replace(/^\[(ERROR|WARNING)\]\s*/, ""),
      }));

      return {
        passed: false,
        tool: "helm lint",
        issues: issues.length > 0 ? issues : [{ severity: "error", message: output }],
        rawOutput: output,
      };
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Detect YAML subtype by inspecting content for known markers.
 */
async function verifyYamlFile(content: string, basename: string): Promise<VerificationResult> {
  // Kubernetes manifests: have apiVersion and kind
  if (/^apiVersion:/m.test(content) && /^kind:/m.test(content)) {
    return verifyWithBinary({
      content,
      filename: "manifest.yaml",
      config: {
        command: "kubectl apply --dry-run=client -f manifest.yaml",
        parser: "kubectl-stderr",
        timeout: 30_000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
  }

  // GitHub Actions: have 'on' and 'jobs' top-level keys
  if (/^on:/m.test(content) && /^jobs:/m.test(content)) {
    return verifyGitHubActions(content);
  }

  // GitLab CI: typically named .gitlab-ci.yml or has stages/script patterns
  if (
    basename === ".gitlab-ci.yml" ||
    basename === ".gitlab-ci.yaml" ||
    (/^stages:/m.test(content) && /script:/m.test(content))
  ) {
    return verifyGitLabCI(content);
  }

  // Docker Compose: has 'services' key
  if (/^services:/m.test(content)) {
    return verifyWithBinary({
      content,
      filename: "docker-compose.yml",
      config: {
        command: "docker compose -f docker-compose.yml config --quiet",
        parser: "docker-compose-config",
        timeout: 30_000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
  }

  // Helm chart (Chart.yaml or values.yaml)
  if (basename === "Chart.yaml") {
    return verifyHelmContent(content, "", {});
  }
  if (basename === "values.yaml") {
    return verifyHelmContent("", content, {});
  }

  // Prometheus config
  if (/^global:/m.test(content) && /scrape_configs:/m.test(content)) {
    return verifyWithBinary({
      content,
      filename: "prometheus.yml",
      config: {
        command: "promtool check config prometheus.yml",
        parser: "promtool",
        timeout: 30_000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
  }

  // Ansible playbook (has hosts + tasks)
  if (/hosts:/m.test(content) && /tasks:/m.test(content)) {
    return verifyWithBinary({
      content,
      filename: "playbook.yml",
      config: {
        command: "ansible-playbook --syntax-check playbook.yml",
        parser: "ansible-syntax",
        timeout: 30_000,
        cwd: "output",
      },
      childProcessPermission: "required",
    });
  }

  return {
    passed: true,
    tool: "yaml-parse",
    issues: [
      {
        severity: "warning",
        message: "Could not detect specific YAML type. File parsed successfully as valid YAML.",
      },
    ],
  };
}

/**
 * Structural verification for GitHub Actions YAML.
 */
function verifyGitHubActions(yamlContent: string): VerificationResult {
  const issues: VerificationResult["issues"] = [];

  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;

    if (!doc || typeof doc !== "object") {
      issues.push({ severity: "error", message: "Invalid YAML structure" });
      return { passed: false, tool: "github-actions-lint", issues };
    }

    if (!doc["on"]) {
      issues.push({ severity: "error", message: "Missing required 'on' trigger" });
    }

    if (!doc.jobs || typeof doc.jobs !== "object") {
      issues.push({ severity: "error", message: "Missing required 'jobs' section" });
    } else {
      const jobs = doc.jobs as Record<string, Record<string, unknown>>;
      for (const [jobName, job] of Object.entries(jobs)) {
        if (!job || typeof job !== "object") {
          issues.push({ severity: "error", message: `Job '${jobName}' is not a valid object` });
          continue;
        }

        if (!job["runs-on"] && !job.uses) {
          issues.push({ severity: "error", message: `Job '${jobName}' missing 'runs-on'` });
        }

        if (!job.steps && !job.uses) {
          issues.push({ severity: "warning", message: `Job '${jobName}' has no steps` });
        }

        if (job.steps && Array.isArray(job.steps)) {
          for (let i = 0; i < job.steps.length; i++) {
            const step = job.steps[i] as Record<string, unknown>;
            if (!step.run && !step.uses) {
              issues.push({
                severity: "warning",
                message: `Job '${jobName}' step ${i + 1} has neither 'run' nor 'uses'`,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    issues.push({
      severity: "error",
      message: `YAML parse error: ${(err as Error).message}`,
    });
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    tool: "github-actions-lint",
    issues,
  };
}

const GITLAB_RESERVED_KEYS = new Set([
  "default",
  "include",
  "stages",
  "variables",
  "workflow",
  "image",
  "services",
  "before_script",
  "after_script",
  "cache",
  "pages",
]);

/**
 * Structural verification for GitLab CI YAML.
 */
function verifyGitLabCI(yamlContent: string): VerificationResult {
  const issues: VerificationResult["issues"] = [];

  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;

    if (!doc || typeof doc !== "object") {
      issues.push({ severity: "error", message: "Invalid YAML structure" });
      return { passed: false, tool: "gitlab-ci-lint", issues };
    }

    const jobNames = Object.keys(doc).filter(
      (k) => !GITLAB_RESERVED_KEYS.has(k) && !k.startsWith("."),
    );

    if (jobNames.length === 0) {
      issues.push({ severity: "warning", message: "No job definitions found" });
    }

    const stages = doc.stages as string[] | undefined;
    if (stages && !Array.isArray(stages)) {
      issues.push({ severity: "error", message: "'stages' must be an array" });
    }

    for (const jobName of jobNames) {
      const job = doc[jobName] as Record<string, unknown>;

      if (!job || typeof job !== "object") {
        issues.push({ severity: "error", message: `Job '${jobName}' is not a valid object` });
        continue;
      }

      if (!job.script && !job.trigger && !job.extends) {
        issues.push({
          severity: "error",
          message: `Job '${jobName}' missing required 'script' property`,
        });
      }

      if (job.script && !Array.isArray(job.script) && typeof job.script !== "string") {
        issues.push({
          severity: "error",
          message: `Job '${jobName}' 'script' must be a string or array`,
        });
      }

      if (job.stage && stages && Array.isArray(stages)) {
        if (!stages.includes(job.stage as string)) {
          issues.push({
            severity: "warning",
            message: `Job '${jobName}' references undeclared stage '${job.stage}'`,
          });
        }
      }
    }
  } catch (err) {
    issues.push({
      severity: "error",
      message: `YAML parse error: ${(err as Error).message}`,
    });
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    tool: "gitlab-ci-lint",
    issues,
  };
}
