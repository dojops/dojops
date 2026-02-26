import { describe, it, expect } from "vitest";
import { verifyGitHubActions } from "./verifier";

describe("verifyGitHubActions", () => {
  it("passes valid workflow", () => {
    const yaml = `
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe("github-actions-lint");
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("fails when missing on trigger", () => {
    const yaml = `
name: CI
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("'on' trigger"))).toBe(true);
  });

  it("fails when missing jobs section", () => {
    const yaml = `
name: CI
on: push
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("'jobs' section"))).toBe(true);
  });

  it("fails when job missing runs-on", () => {
    const yaml = `
name: CI
on: push
jobs:
  build:
    steps:
      - run: echo hello
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("missing 'runs-on'"))).toBe(true);
  });

  it("warns when job has no steps", () => {
    const yaml = `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(true); // Only a warning, not an error
    expect(
      result.issues.some((i) => i.severity === "warning" && i.message.includes("no steps")),
    ).toBe(true);
  });

  it("warns when step has neither run nor uses", () => {
    const yaml = `
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Do nothing
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(true);
    expect(
      result.issues.some(
        (i) => i.severity === "warning" && i.message.includes("neither 'run' nor 'uses'"),
      ),
    ).toBe(true);
  });

  it("fails on invalid YAML", () => {
    const yaml = ": invalid: yaml: {{";
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("YAML parse error"))).toBe(true);
  });

  it("allows reusable workflow jobs (uses without runs-on)", () => {
    const yaml = `
name: CI
on: push
jobs:
  call-workflow:
    uses: org/repo/.github/workflows/ci.yml@main
`;
    const result = verifyGitHubActions(yaml);
    expect(result.passed).toBe(true);
  });
});
