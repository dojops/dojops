import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { discoverDevOpsFiles } from "../../agents/file-discovery";

describe("discoverDevOpsFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-discover-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(relativePath: string, content: string): void {
    const absPath = path.join(tmpDir, relativePath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absPath, content, "utf-8");
  }

  it("returns empty array for empty project", () => {
    const files = discoverDevOpsFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  it("discovers GitHub Actions workflows", () => {
    writeFile(".github/workflows/ci.yml", "name: CI\non: push");
    writeFile(".github/workflows/deploy.yaml", "name: Deploy\non: push");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".github/workflows/ci.yml");
    expect(paths).toContain(".github/workflows/deploy.yaml");
  });

  it("discovers composite actions", () => {
    writeFile(".github/actions/setup-node/action.yml", "name: Setup Node");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".github/actions/setup-node/action.yml");
  });

  it("discovers Dockerfiles", () => {
    writeFile("Dockerfile", "FROM node:20");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("Dockerfile");
  });

  it("discovers Dockerfile variants", () => {
    writeFile("Dockerfile.dev", "FROM node:20-alpine");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("Dockerfile.dev");
  });

  it("discovers docker-compose files", () => {
    writeFile("docker-compose.yml", "version: '3'");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("docker-compose.yml");
  });

  it("discovers Terraform files", () => {
    writeFile("main.tf", 'resource "aws_s3_bucket" {}');

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("main.tf");
  });

  it("discovers shell scripts", () => {
    writeFile("deploy.sh", "#!/bin/bash\necho hello");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("deploy.sh");
  });

  it("discovers Helm charts", () => {
    writeFile("Chart.yaml", "apiVersion: v2\nname: my-app");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("Chart.yaml");
  });

  it("discovers Makefile", () => {
    writeFile("Makefile", "build:\n\techo build");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("Makefile");
  });

  it("discovers Jenkinsfile", () => {
    writeFile("Jenkinsfile", "pipeline {}");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("Jenkinsfile");
  });

  it("discovers GitLab CI", () => {
    writeFile(".gitlab-ci.yml", "stages:\n  - build");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".gitlab-ci.yml");
  });

  it("includes file content", () => {
    const content = "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest";
    writeFile(".github/workflows/ci.yml", content);

    const files = discoverDevOpsFiles(tmpDir);
    const ci = files.find((f) => f.path === ".github/workflows/ci.yml");
    expect(ci).toBeDefined();
    expect(ci!.content).toBe(content);
  });

  it("discovers multiple file types in a project", () => {
    writeFile(".github/workflows/ci.yml", "name: CI");
    writeFile("Dockerfile", "FROM node:20");
    writeFile("docker-compose.yml", "version: '3'");
    writeFile("deploy.sh", "#!/bin/bash");
    writeFile("main.tf", "resource {}");

    const files = discoverDevOpsFiles(tmpDir);
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it("skips node_modules directory", () => {
    writeFile("node_modules/something/ci.yml", "name: CI");

    const files = discoverDevOpsFiles(tmpDir);
    const paths = files.map((f) => f.path);
    expect(paths.every((p) => !p.includes("node_modules"))).toBe(true);
  });

  it("does not duplicate files", () => {
    writeFile("Dockerfile", "FROM node:20");

    const files = discoverDevOpsFiles(tmpDir);
    const dockerPaths = files.filter((f) => f.path === "Dockerfile");
    expect(dockerPaths).toHaveLength(1);
  });
});
