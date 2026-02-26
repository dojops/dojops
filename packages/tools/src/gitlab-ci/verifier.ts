import * as yaml from "js-yaml";
import type { VerificationResult, VerificationIssue } from "@dojops/sdk";

const RESERVED_KEYS = new Set([
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

export function verifyGitLabCI(yamlContent: string): VerificationResult {
  const issues: VerificationIssue[] = [];

  try {
    const doc = yaml.load(yamlContent) as Record<string, unknown>;

    if (!doc || typeof doc !== "object") {
      issues.push({ severity: "error", message: "Invalid YAML structure" });
      return { passed: false, tool: "gitlab-ci-lint", issues };
    }

    // Extract job definitions (non-reserved top-level keys that aren't hidden)
    const jobNames = Object.keys(doc).filter((k) => !RESERVED_KEYS.has(k) && !k.startsWith("."));

    if (jobNames.length === 0) {
      issues.push({ severity: "warning", message: "No job definitions found" });
    }

    // Validate stages if declared
    const stages = doc.stages as string[] | undefined;
    if (stages && !Array.isArray(stages)) {
      issues.push({ severity: "error", message: "'stages' must be an array" });
    }

    // Validate each job
    for (const jobName of jobNames) {
      const job = doc[jobName] as Record<string, unknown>;

      if (!job || typeof job !== "object") {
        issues.push({ severity: "error", message: `Job '${jobName}' is not a valid object` });
        continue;
      }

      // Jobs must have 'script' unless they use 'trigger' or 'extends'
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

      // Validate stage reference
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
