import { describe, it, expect } from "vitest";
import { auditAgainstDocs } from "../context7-doc-auditor";

describe("auditAgainstDocs", () => {
  it("returns no issues when docs or content is empty", () => {
    expect(auditAgainstDocs("", "some docs", "GitHub Actions").issues).toHaveLength(0);
    expect(auditAgainstDocs("some content", "", "GitHub Actions").issues).toHaveLength(0);
    expect(auditAgainstDocs("", "", "GitHub Actions").issues).toHaveLength(0);
  });

  it("returns no issues for unknown technology", () => {
    const result = auditAgainstDocs(
      "uses: actions/checkout@v3",
      "actions/checkout@v4 is current",
      "UnknownTech",
    );
    expect(result.issues).toHaveLength(0);
  });

  describe("GitHub Actions version checks", () => {
    it("detects outdated action versions", () => {
      const generated = [
        "name: CI",
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: actions/checkout@v3",
        "      - uses: actions/setup-node@v3",
      ].join("\n");

      const docs = [
        "## GitHub Actions",
        "Use actions/checkout@v4 for the latest features.",
        "Use actions/setup-node@v4 for Node.js setup.",
      ].join("\n");

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      expect(result.issues).toHaveLength(2);

      expect(result.issues[0].severity).toBe("warning");
      expect(result.issues[0].message).toContain("actions/checkout@v3");
      expect(result.issues[0].message).toContain("v4");
      expect(result.issues[0].rule).toBe("context7-version-check");
      expect(result.issues[0].line).toBe(7);

      expect(result.issues[1].message).toContain("actions/setup-node@v3");
      expect(result.issues[1].message).toContain("v4");
      expect(result.issues[1].line).toBe(8);
    });

    it("does not flag current versions", () => {
      const generated = "      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4";
      const docs = "Use actions/checkout@v4 and actions/setup-node@v4.";

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      expect(result.issues).toHaveLength(0);
    });

    it("does not flag when docs have no version info for the action", () => {
      const generated = "      - uses: custom-org/custom-action@v1";
      const docs = "GitHub Actions supports various marketplace actions.";

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      expect(result.issues).toHaveLength(0);
    });

    it("picks the highest version from docs", () => {
      const generated = "      - uses: docker/build-push-action@v4";
      const docs = [
        "docker/build-push-action@v5 added multiplatform support.",
        "docker/build-push-action@v6 is the latest with enhanced caching.",
      ].join("\n");

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain("v6");
    });
  });

  describe("deprecated syntax detection", () => {
    it("detects deprecated terms from docs", () => {
      // The deprecated term extracted from docs is "set-output command"
      // It must appear in the generated content to be flagged
      const generated = "echo '::set-output command is used here'";
      const docs = "Deprecated: set-output command. Use $GITHUB_OUTPUT instead.";

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      const deprecatedIssues = result.issues.filter((i) => i.rule === "context7-deprecated-check");
      expect(deprecatedIssues.length).toBeGreaterThanOrEqual(1);
      expect(deprecatedIssues[0].severity).toBe("warning");
    });

    it("detects 'replaced by' pattern", () => {
      // "replaced by X" extracts X — flag it if X appears in generated content
      const generated = "echo $GITHUB_STATE > state.txt";
      const docs = "The save-state command was replaced by `GITHUB_STATE` environment file.";

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      const deprecatedIssues = result.issues.filter((i) => i.rule === "context7-deprecated-check");
      // "GITHUB_STATE" is extracted from "replaced by" and found in generated content
      expect(deprecatedIssues.length).toBeGreaterThanOrEqual(1);
    });

    it("does not flag terms not present in generated content", () => {
      const generated = "runs-on: ubuntu-latest";
      const docs = "Deprecated: ubuntu-18.04 runner image.";

      const result = auditAgainstDocs(generated, docs, "GitHub Actions");
      const deprecatedIssues = result.issues.filter((i) => i.rule === "context7-deprecated-check");
      expect(deprecatedIssues).toHaveLength(0);
    });
  });

  describe("Dockerfile version checks", () => {
    it("returns no issues for Dockerfile without version concerns", () => {
      const generated = "FROM node:20-slim\nRUN npm ci";
      const docs = "Use official Node.js images from Docker Hub.";

      const result = auditAgainstDocs(generated, docs, "Dockerfile");
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("Terraform version checks", () => {
    it("returns no issues for Terraform without version concerns", () => {
      const generated = 'source = "hashicorp/aws"\nversion = "~> 5.0"';
      const docs = "Use the AWS provider from HashiCorp.";

      const result = auditAgainstDocs(generated, docs, "Terraform");
      expect(result.issues).toHaveLength(0);
    });
  });
});
