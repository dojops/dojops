import * as yaml from "js-yaml";
import type { VerificationResult, VerificationIssue } from "@dojops/sdk";

export function verifyGitHubActions(yamlContent: string): VerificationResult {
  const issues: VerificationIssue[] = [];

  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;

    if (!doc || typeof doc !== "object") {
      issues.push({ severity: "error", message: "Invalid YAML structure" });
      return { passed: false, tool: "github-actions-lint", issues };
    }

    // Required: 'on' trigger (js-yaml v4 uses YAML 1.2; 'on' is parsed as literal key, not boolean)
    if (!doc["on"]) {
      issues.push({ severity: "error", message: "Missing required 'on' trigger" });
    }

    // Required: 'jobs' section
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
          // 'uses' is for reusable workflow calls which don't need runs-on
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
