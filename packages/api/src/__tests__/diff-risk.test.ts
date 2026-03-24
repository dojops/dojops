import { describe, it, expect } from "vitest";
import { classifyDiffRisk, parseDiff } from "../diff-risk";

// ── parseDiff ────────────────────────────────────────────────────

describe("parseDiff", () => {
  it("parses a simple unified diff", () => {
    const diff = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,3 @@",
      "-const a = 1;",
      "+const a = 2;",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/app.ts");
    expect(files[0].changeType).toBe("modified");
    expect(files[0].linesChanged).toBe(2); // one removal + one addition
  });

  it("detects new files", () => {
    const diff = [
      "diff --git a/new-file.ts b/new-file.ts",
      "--- /dev/null",
      "+++ b/new-file.ts",
      "@@ -0,0 +1,5 @@",
      "+line 1",
      "+line 2",
      "+line 3",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].changeType).toBe("added");
    expect(files[0].linesChanged).toBe(3);
  });

  it("detects deleted files", () => {
    const diff = [
      "diff --git a/old-file.ts b/old-file.ts",
      "--- a/old-file.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-line 1",
      "-line 2",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].changeType).toBe("deleted");
    expect(files[0].linesChanged).toBe(2);
  });

  it("detects renamed files", () => {
    const diff = [
      "diff --git a/old-name.ts b/new-name.ts",
      "--- a/old-name.ts",
      "+++ b/new-name.ts",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("new-name.ts");
    expect(files[0].changeType).toBe("renamed");
  });

  it("parses multiple files in one diff", () => {
    const diff = [
      "diff --git a/file1.ts b/file1.ts",
      "--- a/file1.ts",
      "+++ b/file1.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/file2.ts b/file2.ts",
      "--- a/file2.ts",
      "+++ b/file2.ts",
      "@@ -1 +1 @@",
      "-old2",
      "+new2",
    ].join("\n");

    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("file1.ts");
    expect(files[1].path).toBe("file2.ts");
  });

  it("returns empty for non-diff content", () => {
    const files = parseDiff("not a diff at all");
    expect(files).toHaveLength(0);
  });
});

// ── classifyDiffRisk ─────────────────────────────────────────────

describe("classifyDiffRisk", () => {
  it("returns INFO for empty diff", () => {
    const report = classifyDiffRisk("");
    expect(report.overallRisk).toBe("INFO");
    expect(report.files).toHaveLength(0);
    expect(report.suggestedReviewers).toHaveLength(0);
  });

  it("classifies Terraform state changes as CRITICAL", () => {
    const diff = [
      "diff --git a/terraform.tfstate b/terraform.tfstate",
      "--- a/terraform.tfstate",
      "+++ b/terraform.tfstate",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("CRITICAL");
    expect(report.files[0].risk).toBe("CRITICAL");
    expect(report.suggestedReviewers).toContain("terraform-specialist");
  });

  it("classifies Terraform .tf files as HIGH", () => {
    const diff = [
      "diff --git a/infra/main.tf b/infra/main.tf",
      "--- a/infra/main.tf",
      "+++ b/infra/main.tf",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("HIGH");
    expect(report.files[0].risk).toBe("HIGH");
    expect(report.suggestedReviewers).toContain("terraform-specialist");
  });

  it("classifies GitHub Actions workflows as HIGH", () => {
    const diff = [
      "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
      "--- a/.github/workflows/ci.yml",
      "+++ b/.github/workflows/ci.yml",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("HIGH");
    expect(report.suggestedReviewers).toContain("cicd-specialist");
  });

  it("classifies Dockerfiles as HIGH", () => {
    const diff = [
      "diff --git a/Dockerfile b/Dockerfile",
      "--- a/Dockerfile",
      "+++ b/Dockerfile",
      "@@ -1 +1 @@",
      "-FROM node:18",
      "+FROM node:20",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("HIGH");
    expect(report.suggestedReviewers).toContain("docker-specialist");
  });

  it("classifies test files as LOW", () => {
    const diff = [
      "diff --git a/src/app.test.ts b/src/app.test.ts",
      "--- a/src/app.test.ts",
      "+++ b/src/app.test.ts",
      "@@ -1 +1 @@",
      "-old test",
      "+new test",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("LOW");
    expect(report.files[0].risk).toBe("LOW");
  });

  it("classifies README changes as LOW", () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("LOW");
  });

  it("classifies secrets path changes as CRITICAL", () => {
    const diff = [
      "diff --git a/deploy/secrets/api-key.json b/deploy/secrets/api-key.json",
      "--- a/deploy/secrets/api-key.json",
      "+++ b/deploy/secrets/api-key.json",
      "@@ -1 +1 @@",
      '-{"key": "old"}',
      '+{"key": "new"}',
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("CRITICAL");
    expect(report.suggestedReviewers).toContain("security-auditor");
  });

  it("classifies Kubernetes RBAC as CRITICAL", () => {
    const diff = [
      "diff --git a/k8s/rbac.yaml b/k8s/rbac.yaml",
      "--- a/k8s/rbac.yaml",
      "+++ b/k8s/rbac.yaml",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("CRITICAL");
  });

  it("applies deletion multiplier (increases risk)", () => {
    // A deleted .ts source file: base score 2, * 1.5 = 3 -> HIGH
    const diff = [
      "diff --git a/src/important.ts b/src/important.ts",
      "--- a/src/important.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-line 1",
      "-line 2",
      "-line 3",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.files[0].changeType).toBe("deleted");
    expect(report.files[0].reasons).toContain("File deletion (higher risk)");
    // 2 * 1.5 = 3 -> HIGH
    expect(report.files[0].risk).toBe("HIGH");
  });

  it("applies addition multiplier (decreases risk)", () => {
    // A new .ts source file: base score 2, * 0.8 = 1.6 -> rounds to 2 -> MEDIUM
    const diff = [
      "diff --git a/src/new-feature.ts b/src/new-feature.ts",
      "--- /dev/null",
      "+++ b/src/new-feature.ts",
      "@@ -0,0 +1,3 @@",
      "+line 1",
      "+line 2",
      "+line 3",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.files[0].changeType).toBe("added");
    // 2 * 0.8 = 1.6 rounds to 2 -> MEDIUM
    expect(report.files[0].risk).toBe("MEDIUM");
  });

  it("uses highest risk across multiple files for overall risk", () => {
    const diff = [
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/terraform.tfstate b/terraform.tfstate",
      "--- a/terraform.tfstate",
      "+++ b/terraform.tfstate",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("CRITICAL");
    expect(report.files).toHaveLength(2);
  });

  it("generates summary with counts", () => {
    const diff = [
      "diff --git a/main.tf b/main.tf",
      "--- a/main.tf",
      "+++ b/main.tf",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/README.md b/README.md",
      "--- a/README.md",
      "+++ b/README.md",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.summary).toContain("2 file(s) changed");
    expect(report.summary).toContain("4 line(s) modified");
    expect(report.summary).toContain("1 high risk");
  });

  it("adds size boost for large changes", () => {
    // A .gitignore (LOW, score 1) with 150 lines -> 1 * 1.0 + 0.5 = 1.5 rounds to 2 -> MEDIUM
    const additions = Array.from({ length: 150 }, (_, i) => `+line ${i}`).join("\n");
    const diff = [
      "diff --git a/.gitignore b/.gitignore",
      "--- a/.gitignore",
      "+++ b/.gitignore",
      "@@ -1,0 +1,150 @@",
      additions,
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.files[0].linesChanged).toBe(150);
    expect(report.files[0].reasons).toContain("Large change (150 lines)");
    // 1 * 1.0 + 0.5 = 1.5 rounds to 2 -> MEDIUM
    expect(report.files[0].risk).toBe("MEDIUM");
  });

  it("classifies production config as CRITICAL", () => {
    const diff = [
      "diff --git a/deploy/production.yml b/deploy/production.yml",
      "--- a/deploy/production.yml",
      "+++ b/deploy/production.yml",
      "@@ -1 +1 @@",
      "-replicas: 2",
      "+replicas: 4",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("CRITICAL");
    expect(report.suggestedReviewers).toContain("sre-specialist");
  });

  it("classifies Helm chart changes as HIGH", () => {
    const diff = [
      "diff --git a/charts/helm/values.yaml b/charts/helm/values.yaml",
      "--- a/charts/helm/values.yaml",
      "+++ b/charts/helm/values.yaml",
      "@@ -1 +1 @@",
      "-replicas: 1",
      "+replicas: 3",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("HIGH");
    expect(report.suggestedReviewers).toContain("kubernetes-specialist");
  });

  it("collects multiple unique reviewers sorted alphabetically", () => {
    const diff = [
      "diff --git a/main.tf b/main.tf",
      "--- a/main.tf",
      "+++ b/main.tf",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml",
      "--- a/.github/workflows/ci.yml",
      "+++ b/.github/workflows/ci.yml",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/Dockerfile b/Dockerfile",
      "--- a/Dockerfile",
      "+++ b/Dockerfile",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.suggestedReviewers).toEqual([
      "cicd-specialist",
      "docker-specialist",
      "terraform-specialist",
    ]);
  });

  it("classifies application source code as MEDIUM", () => {
    const diff = [
      "diff --git a/src/utils.ts b/src/utils.ts",
      "--- a/src/utils.ts",
      "+++ b/src/utils.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.overallRisk).toBe("MEDIUM");
    expect(report.files[0].risk).toBe("MEDIUM");
  });

  it("classifies Prometheus config as MEDIUM", () => {
    const diff = [
      "diff --git a/monitoring/prometheus.yml b/monitoring/prometheus.yml",
      "--- a/monitoring/prometheus.yml",
      "+++ b/monitoring/prometheus.yml",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    expect(report.suggestedReviewers).toContain("observability-specialist");
  });

  it("cross-checks with executor classifyPathRisk for coherence", () => {
    // .env files are HIGH in executor's path classification but not in
    // diff-risk's local rules when the path doesn't match the secrets pattern.
    // The cross-check elevates them from INFO to HIGH.
    const diff = [
      "diff --git a/.env b/.env",
      "--- a/.env",
      "+++ b/.env",
      "@@ -1 +1 @@",
      "-DB_PASS=old",
      "+DB_PASS=new",
    ].join("\n");

    const report = classifyDiffRisk(diff);
    // Executor classifies .env as HIGH; cross-check should lift the score
    expect(["HIGH", "CRITICAL"]).toContain(report.overallRisk);
    expect(report.files[0].reasons).toContain("Executor policy: HIGH");
  });
});
