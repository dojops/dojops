import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { detectTerraformProject } from "./detector";

describe("detectTerraformProject", () => {
  let tmpDir: string;

  function makeTmpDir(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dojops-tf-detect-"));
    return tmpDir;
  }

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("detects existing terraform project with .tf files", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "main.tf"), 'provider "aws" {}');
    const result = detectTerraformProject(dir);
    expect(result.exists).toBe(true);
    expect(result.providers).toContain("aws");
  });

  it("detects multiple providers", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "main.tf"), 'provider "aws" {}\nresource "google_compute" {}');
    const result = detectTerraformProject(dir);
    expect(result.providers).toContain("aws");
    expect(result.providers).toContain("gcp");
  });

  it("detects terraform state", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "terraform.tfstate"), "{}");
    const result = detectTerraformProject(dir);
    expect(result.hasState).toBe(true);
  });

  it("returns empty result for non-terraform directory", () => {
    const dir = makeTmpDir();
    const result = detectTerraformProject(dir);
    expect(result.exists).toBe(false);
    expect(result.hasState).toBe(false);
    expect(result.providers).toHaveLength(0);
  });
});
