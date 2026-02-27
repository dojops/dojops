import { describe, it, expect } from "vitest";
import { parsePromtool } from "../../parsers/promtool";
import { parseSystemdAnalyze } from "../../parsers/systemd-analyze";
import { parseMakeDryrun } from "../../parsers/make-dryrun";
import { parseAnsibleSyntax } from "../../parsers/ansible-syntax";
import { parseDockerComposeConfig } from "../../parsers/docker-compose-config";

describe("parsePromtool", () => {
  it("detects error lines", () => {
    const output =
      "Checking prometheus.yml\n  FAILED: expected scrape_interval to be valid\nSome error here";
    const issues = parsePromtool(output);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("detects warning lines", () => {
    const output = "WARNING: deprecated field used";
    const issues = parsePromtool(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("skips success lines", () => {
    const output = "SUCCESS: prometheus.yml is valid";
    const issues = parsePromtool(output);
    expect(issues).toHaveLength(0);
  });

  it("handles empty output", () => {
    const issues = parsePromtool("");
    expect(issues).toHaveLength(0);
  });
});

describe("parseSystemdAnalyze", () => {
  it("detects warning lines", () => {
    const output = "myapp.service: warning: Unit file changed on disk";
    const issues = parseSystemdAnalyze(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("detects error lines", () => {
    const output = "myapp.service: error parsing ExecStart=";
    const issues = parseSystemdAnalyze(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("handles empty output", () => {
    const issues = parseSystemdAnalyze("");
    expect(issues).toHaveLength(0);
  });
});

describe("parseMakeDryrun", () => {
  it("detects make errors with ***", () => {
    const output = "make: *** No rule to make target 'build'. Stop.";
    const issues = parseMakeDryrun(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("detects error keyword lines", () => {
    const output = "Makefile:10: error: missing separator";
    const issues = parseMakeDryrun(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("detects warning lines", () => {
    const output = "Makefile:5: warning: overriding recipe for target";
    const issues = parseMakeDryrun(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("handles clean output", () => {
    const output = "echo 'build'\nnpm run build";
    const issues = parseMakeDryrun(output);
    expect(issues).toHaveLength(0);
  });
});

describe("parseAnsibleSyntax", () => {
  it("detects ERROR lines", () => {
    const output =
      "ERROR! Syntax Error while loading YAML.\n  The error appears to be in playbook.yml";
    const issues = parseAnsibleSyntax(output);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("detects warning lines", () => {
    const output = "[WARNING]: No inventory was parsed";
    const issues = parseAnsibleSyntax(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("skips syntax ok messages", () => {
    const output = "playbook: playbook.yml\n\nSyntax OK";
    const issues = parseAnsibleSyntax(output);
    // "playbook:" line has no error/warning, "Syntax OK" is skipped
    expect(issues.every((i) => i.severity !== "error")).toBe(true);
  });

  it("handles empty output", () => {
    const issues = parseAnsibleSyntax("");
    expect(issues).toHaveLength(0);
  });
});

describe("parseDockerComposeConfig", () => {
  it("detects error lines", () => {
    const output = "service 'web' refers to undefined network 'backend': invalid compose project";
    const issues = parseDockerComposeConfig(output);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });

  it("detects warning lines", () => {
    const output = "WARNING: Some services use deprecated build options";
    const issues = parseDockerComposeConfig(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("handles clean output (valid config)", () => {
    const output = "name: myproject\nservices:\n  web:\n    image: nginx";
    const issues = parseDockerComposeConfig(output);
    expect(issues).toHaveLength(0);
  });

  it("handles empty output", () => {
    const issues = parseDockerComposeConfig("");
    expect(issues).toHaveLength(0);
  });
});
