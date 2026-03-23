import { describe, it, expect } from "vitest";
import {
  generateRemediationPlan,
  remediateNpmFindings,
  remediatePipFindings,
  remediateIacFindings,
  remediateSecretFindings,
  remediateHadolintFindings,
  remediateShellcheckFindings,
} from "../remediate";
import type { ScanFinding } from "../types";

// ── Helpers ──────────────────────────────────────────────────────

function makeFinding(overrides: Partial<ScanFinding> & { id: string }): ScanFinding {
  return {
    tool: "trivy",
    severity: "HIGH",
    category: "SECURITY",
    message: "test finding",
    autoFixAvailable: false,
    ...overrides,
  };
}

// ── remediateNpmFindings ─────────────────────────────────────────

describe("remediateNpmFindings", () => {
  it("generates specific install command when fixVersion is present", () => {
    const findings = [
      makeFinding({
        id: "npm-1",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "lodash: prototype pollution",
        fixVersion: "4.17.21",
        autoFixAvailable: true,
      }),
    ];

    const actions = remediateNpmFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("update");
    expect(actions[0].command).toBe("npm install lodash@4.17.21");
    expect(actions[0].confidence).toBe("high");
  });

  it("falls back to npm audit fix when autoFixAvailable but no fixVersion", () => {
    const findings = [
      makeFinding({
        id: "npm-2",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "some-package vulnerability",
        autoFixAvailable: true,
      }),
    ];

    const actions = remediateNpmFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("npm audit fix");
    expect(actions[0].confidence).toBe("medium");
  });

  it("marks as manual when no fix available", () => {
    const findings = [
      makeFinding({
        id: "npm-3",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "unfixable issue",
        autoFixAvailable: false,
      }),
    ];

    const actions = remediateNpmFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("manual");
    expect(actions[0].confidence).toBe("low");
    expect(actions[0].command).toBeUndefined();
  });

  it("returns empty for non-npm findings", () => {
    const findings = [makeFinding({ id: "trivy-1", tool: "trivy", category: "SECURITY" })];
    expect(remediateNpmFindings(findings)).toHaveLength(0);
  });

  it("uses recommendation when no fixVersion and not autoFixable", () => {
    const findings = [
      makeFinding({
        id: "npm-4",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "axios: SSRF vulnerability",
        recommendation: "Upgrade to axios@1.6.0",
        autoFixAvailable: false,
      }),
    ];

    const actions = remediateNpmFindings(findings);
    expect(actions[0].description).toContain("Upgrade to axios@1.6.0");
  });
});

// ── remediatePipFindings ─────────────────────────────────────────

describe("remediatePipFindings", () => {
  it("generates pip install --upgrade command when fixVersion is present", () => {
    const findings = [
      makeFinding({
        id: "pip-1",
        tool: "pip-audit",
        category: "DEPENDENCY",
        message: "requests: CVE-2023-1234",
        fixVersion: "2.31.0",
      }),
    ];

    const actions = remediatePipFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("update");
    expect(actions[0].command).toBe("pip install --upgrade requests==2.31.0");
    expect(actions[0].confidence).toBe("high");
  });

  it("marks as manual when no fixVersion", () => {
    const findings = [
      makeFinding({
        id: "pip-2",
        tool: "pip-audit",
        category: "DEPENDENCY",
        message: "some-lib: no fix yet",
      }),
    ];

    const actions = remediatePipFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("manual");
    expect(actions[0].confidence).toBe("low");
  });

  it("returns empty for non-pip findings", () => {
    const findings = [makeFinding({ id: "npm-1", tool: "npm-audit" })];
    expect(remediatePipFindings(findings)).toHaveLength(0);
  });
});

// ── remediateIacFindings ─────────────────────────────────────────

describe("remediateIacFindings", () => {
  it("flags IaC findings as manual", () => {
    const findings = [
      makeFinding({
        id: "iac-1",
        tool: "checkov",
        category: "IAC",
        message: "S3 bucket is public",
        recommendation: "Set acl to private",
      }),
    ];

    const actions = remediateIacFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("manual");
    expect(actions[0].description).toBe("Set acl to private");
    expect(actions[0].confidence).toBe("medium");
  });

  it("only matches IAC category findings", () => {
    const findings = [makeFinding({ id: "t-1", tool: "trivy", category: "SECURITY" })];
    expect(remediateIacFindings(findings)).toHaveLength(0);
  });
});

// ── remediateSecretFindings ──────────────────────────────────────

describe("remediateSecretFindings", () => {
  it("marks secrets as manual with rotate instruction", () => {
    const findings = [
      makeFinding({
        id: "sec-1",
        tool: "gitleaks",
        category: "SECRETS",
        message: "AWS secret key detected",
      }),
    ];

    const actions = remediateSecretFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("manual");
    expect(actions[0].description).toContain("Rotate credential");
    expect(actions[0].confidence).toBe("high");
  });

  it("matches findings with SECRETS category from any tool", () => {
    const findings = [
      makeFinding({
        id: "sec-2",
        tool: "semgrep",
        category: "SECRETS",
        message: "hardcoded password",
      }),
    ];

    const actions = remediateSecretFindings(findings);
    expect(actions).toHaveLength(1);
  });
});

// ── remediateHadolintFindings ────────────────────────────────────

describe("remediateHadolintFindings", () => {
  it("generates configure action for Dockerfile findings", () => {
    const findings = [
      makeFinding({
        id: "dl-1",
        tool: "hadolint",
        category: "SECURITY",
        message: "DL3007: Use specific image tag",
        recommendation: "Pin the image version instead of using latest",
      }),
    ];

    const actions = remediateHadolintFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("configure");
    expect(actions[0].description).toBe("Pin the image version instead of using latest");
    expect(actions[0].confidence).toBe("medium");
  });
});

// ── remediateShellcheckFindings ──────────────────────────────────

describe("remediateShellcheckFindings", () => {
  it("generates configure action for shell script findings", () => {
    const findings = [
      makeFinding({
        id: "sc-1",
        tool: "shellcheck",
        category: "SECURITY",
        message: "SC2086: Double quote to prevent globbing",
        recommendation: 'Use "$var" instead of $var',
      }),
    ];

    const actions = remediateShellcheckFindings(findings);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("configure");
    expect(actions[0].confidence).toBe("medium");
  });
});

// ── generateRemediationPlan ──────────────────────────────────────

describe("generateRemediationPlan", () => {
  it("returns empty plan for empty findings", () => {
    const plan = generateRemediationPlan([]);
    expect(plan.actions).toHaveLength(0);
    expect(plan.autoFixable).toBe(0);
    expect(plan.manualRequired).toBe(0);
    expect(plan.summary).toBe("No findings to remediate.");
  });

  it("aggregates actions from multiple tools", () => {
    const findings = [
      makeFinding({
        id: "npm-1",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "lodash: prototype pollution",
        fixVersion: "4.17.21",
        autoFixAvailable: true,
      }),
      makeFinding({
        id: "gl-1",
        tool: "gitleaks",
        category: "SECRETS",
        message: "API key in code",
      }),
      makeFinding({
        id: "had-1",
        tool: "hadolint",
        category: "SECURITY",
        message: "DL3007: Use specific tag",
      }),
    ];

    const plan = generateRemediationPlan(findings);
    expect(plan.actions).toHaveLength(3);
    expect(plan.autoFixable).toBe(1); // only the npm finding with a command + high confidence
    expect(plan.manualRequired).toBe(2);
  });

  it("handles unrecognized tools as manual actions", () => {
    const findings = [
      makeFinding({
        id: "unknown-1",
        tool: "custom-scanner",
        category: "SECURITY",
        message: "custom issue",
      }),
    ];

    const plan = generateRemediationPlan(findings);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].action).toBe("manual");
    expect(plan.actions[0].confidence).toBe("low");
  });

  it("counts auto-fixable correctly", () => {
    const findings = [
      makeFinding({
        id: "npm-1",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "lodash: vuln",
        fixVersion: "4.17.21",
        autoFixAvailable: true,
      }),
      makeFinding({
        id: "npm-2",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "axios: vuln",
        autoFixAvailable: true,
      }),
      makeFinding({
        id: "npm-3",
        tool: "npm-audit",
        category: "DEPENDENCY",
        message: "unfixable",
        autoFixAvailable: false,
      }),
    ];

    const plan = generateRemediationPlan(findings);
    // npm-1 has fixVersion -> high confidence + command = auto-fixable
    // npm-2 has autoFixAvailable -> medium confidence + command = auto-fixable
    // npm-3 has neither -> low confidence, no command = manual
    expect(plan.autoFixable).toBe(2);
    expect(plan.manualRequired).toBe(1);
    expect(plan.summary).toContain("3 action(s)");
  });
});
