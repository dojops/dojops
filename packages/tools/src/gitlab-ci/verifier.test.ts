import { describe, it, expect } from "vitest";
import { verifyGitLabCI } from "./verifier";

describe("verifyGitLabCI", () => {
  it("passes valid GitLab CI config", () => {
    const yaml = `
stages:
  - build
  - test

build:
  stage: build
  script:
    - npm install
    - npm run build

test:
  stage: test
  script:
    - npm test
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true);
    expect(result.tool).toBe("gitlab-ci-lint");
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("fails when job missing script", () => {
    const yaml = `
build:
  stage: build
  image: node:18
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("missing required 'script'"))).toBe(true);
  });

  it("allows jobs with trigger instead of script", () => {
    const yaml = `
deploy:
  trigger:
    project: org/downstream
    branch: main
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true);
  });

  it("allows jobs with extends instead of script", () => {
    const yaml = `
.base:
  script:
    - echo hello

build:
  extends: .base
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true);
  });

  it("warns when stage references undeclared stage", () => {
    const yaml = `
stages:
  - build

test:
  stage: deploy
  script:
    - npm test
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true); // Only a warning
    expect(
      result.issues.some((i) => i.severity === "warning" && i.message.includes("undeclared stage")),
    ).toBe(true);
  });

  it("fails when stages is not an array", () => {
    const yaml = `
stages: build

build:
  script:
    - npm run build
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("'stages' must be an array"))).toBe(true);
  });

  it("warns when no job definitions found", () => {
    const yaml = `
default:
  image: node:18
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true);
    expect(
      result.issues.some(
        (i) => i.severity === "warning" && i.message.includes("No job definitions"),
      ),
    ).toBe(true);
  });

  it("fails on invalid YAML", () => {
    const yaml = ": invalid: yaml: {{";
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.message.includes("YAML parse error"))).toBe(true);
  });

  it("skips hidden jobs (starting with dot)", () => {
    const yaml = `
.template:
  image: node:18

build:
  extends: .template
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true);
    // .template should not be validated as a job
  });

  it("accepts string script", () => {
    const yaml = `
build:
  script: npm run build
`;
    const result = verifyGitLabCI(yaml);
    expect(result.passed).toBe(true);
  });
});
