import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as execAsyncMod from "../../exec-async";

vi.mock("../../exec-async");
vi.mock("node:fs");

const mockExecFileAsync = vi.mocked(execAsyncMod.execFileAsync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);

/**
 * Helper: configure mockExecFileAsync to resolve with stdout.
 */
function mockExecFileSuccess(stdout: string): void {
  mockExecFileAsync.mockResolvedValue({ stdout, stderr: "" });
}

/**
 * Helper: configure mockExecFileAsync to reject with an error.
 */
function mockExecFileError(err: Error & { stdout?: string; stderr?: string; code?: string }): void {
  mockExecFileAsync.mockRejectedValue(err);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockExistsSync.mockReturnValue(false);
});

// ── npm ────────────────────────────────────────────────────────────

describe("scanNpm", () => {
  it("skips when package-lock.json not found", async () => {
    const { scanNpm } = await import("../../scanners/npm");
    mockExistsSync.mockReturnValue(false);
    const result = await scanNpm("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("No package-lock.json");
  });

  it("skips when npm not found (ENOENT)", async () => {
    const { scanNpm } = await import("../../scanners/npm");
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      // Only package-lock.json exists
      return s.endsWith("package-lock.json");
    });
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanNpm("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("npm not found");
  });

  it("parses npm audit JSON output", async () => {
    const { scanNpm } = await import("../../scanners/npm");
    mockExistsSync.mockImplementation((p) => String(p).endsWith("package-lock.json"));
    mockExecFileSuccess(
      JSON.stringify({
        vulnerabilities: {
          lodash: {
            severity: "high",
            via: [{ title: "Prototype Pollution" }],
            fixAvailable: { name: "lodash", version: "4.17.21" },
          },
          express: {
            severity: "moderate",
            via: ["qs"],
            fixAvailable: true,
          },
        },
      }),
    );

    const result = await scanNpm("/project");
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].severity).toBe("HIGH");
    expect(result.findings[0].category).toBe("DEPENDENCY");
    expect(result.findings[0].tool).toBe("npm-audit");
    expect(result.findings[1].severity).toBe("MEDIUM");
  });

  it("handles npm audit non-zero exit with JSON stdout", async () => {
    const { scanNpm } = await import("../../scanners/npm");
    mockExistsSync.mockImplementation((p) => String(p).endsWith("package-lock.json"));
    const err = Object.assign(new Error("exit 1"), {
      stdout: JSON.stringify({
        vulnerabilities: {
          pkg: {
            severity: "critical",
            via: ["CVE-2024-0001"],
            fixAvailable: false,
          },
        },
      }),
      stderr: "",
      status: 1,
    });
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });

    const result = await scanNpm("/project");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("CRITICAL");
  });

  it("discovers and scans sub-project directories", async () => {
    const { scanNpm } = await import("../../scanners/npm");

    // Root has no lock file, but two child dirs do
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === "/project/package-lock.json") return false;
      if (s === "/project/backend/package-lock.json") return true;
      if (s === "/project/frontend/package-lock.json") return true;
      return false;
    });

    mockReaddirSync.mockImplementation((dir) => {
      if (String(dir) === "/project") {
        return [
          { name: "backend", isDirectory: () => true },
          { name: "frontend", isDirectory: () => true },
          { name: "README.md", isDirectory: () => false },
        ] as unknown as fs.Dirent[];
      }
      // Level 2 child dirs (empty)
      return [] as unknown as fs.Dirent[];
    });

    mockExecFileSuccess(
      JSON.stringify({
        vulnerabilities: {
          lodash: {
            severity: "high",
            via: [{ title: "Prototype Pollution" }],
            fixAvailable: true,
          },
        },
      }),
    );

    const result = await scanNpm("/project");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].file).toBe("backend/package-lock.json");
    expect(result.findings[0].message).toContain("backend:");
    expect(result.findings[1].file).toBe("frontend/package-lock.json");
    expect(result.findings[1].message).toContain("frontend:");
    // npm audit should be called twice (once per sub-project)
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });
});

// ── pip ────────────────────────────────────────────────────────────

describe("scanPip", () => {
  it("skips when no Python files found", async () => {
    const { scanPip } = await import("../../scanners/pip");
    mockExistsSync.mockReturnValue(false);
    const result = await scanPip("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("No Python dependency file");
  });

  it("skips when pip-audit not found (ENOENT)", async () => {
    const { scanPip } = await import("../../scanners/pip");
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("requirements.txt");
    });
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanPip("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("pip-audit not found");
  });

  it("parses pip-audit JSON output", async () => {
    const { scanPip } = await import("../../scanners/pip");
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes("requirements.txt");
    });
    mockExecFileSuccess(
      JSON.stringify([
        {
          name: "django",
          version: "3.2.0",
          vulns: [
            {
              id: "CVE-2024-0001",
              fix_versions: ["3.2.25"],
              description: "SQL injection vulnerability",
            },
          ],
        },
      ]),
    );

    const result = await scanPip("/project");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("HIGH");
    expect(result.findings[0].category).toBe("DEPENDENCY");
    expect(result.findings[0].autoFixAvailable).toBe(true);
  });

  it("discovers and scans sub-project directories", async () => {
    const { scanPip } = await import("../../scanners/pip");

    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === "/project/api/requirements.txt") return true;
      if (s === "/project/worker/pyproject.toml") return true;
      if (s === "/project/worker/requirements.txt") return false;
      return false;
    });

    mockReaddirSync.mockImplementation((dir) => {
      if (String(dir) === "/project") {
        return [
          { name: "api", isDirectory: () => true },
          { name: "worker", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    mockExecFileSuccess(
      JSON.stringify([
        {
          name: "flask",
          version: "2.0.0",
          vulns: [
            {
              id: "CVE-2024-0002",
              fix_versions: ["2.3.0"],
            },
          ],
        },
      ]),
    );

    const result = await scanPip("/project");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].file).toBe("api/requirements.txt");
    expect(result.findings[0].message).toContain("api:");
    expect(result.findings[1].file).toBe("worker/pyproject.toml");
    expect(mockExecFileAsync).toHaveBeenCalledTimes(2);
  });
});

// ── trivy ──────────────────────────────────────────────────────────

describe("scanTrivy", () => {
  it("skips when trivy not found (ENOENT)", async () => {
    const { scanTrivy } = await import("../../scanners/trivy");
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanTrivy("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("trivy not found");
  });

  it("parses trivy JSON with vulnerabilities and misconfigurations", async () => {
    const { scanTrivy } = await import("../../scanners/trivy");
    mockExecFileSuccess(
      JSON.stringify({
        Results: [
          {
            Target: "package-lock.json",
            Vulnerabilities: [
              {
                VulnerabilityID: "CVE-2024-0001",
                PkgName: "lodash",
                InstalledVersion: "4.17.15",
                FixedVersion: "4.17.21",
                Severity: "HIGH",
                Title: "Prototype Pollution",
              },
            ],
          },
          {
            Target: "Dockerfile",
            Misconfigurations: [
              {
                ID: "DS001",
                Title: "Running as root",
                Description: "Container runs as root user",
                Severity: "MEDIUM",
                Resolution: "Add USER instruction",
              },
            ],
          },
          {
            Target: ".env",
            Secrets: [
              {
                RuleID: "aws-access-key-id",
                Title: "AWS Access Key",
                Severity: "CRITICAL",
                Match: "AKIA...",
                StartLine: 5,
              },
            ],
          },
        ],
      }),
    );

    const result = await scanTrivy("/project");
    expect(result.findings).toHaveLength(3);
    expect(result.findings[0].category).toBe("SECURITY");
    expect(result.findings[0].severity).toBe("HIGH");
    expect(result.findings[1].category).toBe("IAC");
    expect(result.findings[1].severity).toBe("MEDIUM");
    expect(result.findings[2].category).toBe("SECRETS");
    expect(result.findings[2].severity).toBe("CRITICAL");
  });
});

// ── checkov ────────────────────────────────────────────────────────

describe("scanCheckov", () => {
  it("skips when checkov not found (ENOENT)", async () => {
    const { scanCheckov } = await import("../../scanners/checkov");
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanCheckov("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("checkov not found");
  });

  it("parses checkov JSON with failed checks", async () => {
    const { scanCheckov } = await import("../../scanners/checkov");
    mockExecFileSuccess(
      JSON.stringify({
        results: {
          failed_checks: [
            {
              check_id: "CKV_AWS_21",
              check_result: { result: "FAILED" },
              file_path: "/main.tf",
              file_line_range: [10, 15],
              resource: "aws_s3_bucket.data",
              guideline: "Enable versioning on S3 bucket",
              severity: "HIGH",
            },
          ],
        },
      }),
    );

    const result = await scanCheckov("/project");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe("IAC");
    expect(result.findings[0].severity).toBe("HIGH");
    expect(result.findings[0].file).toBe("/main.tf");
  });

  it("handles array output (multiple frameworks)", async () => {
    const { scanCheckov } = await import("../../scanners/checkov");
    mockExecFileSuccess(
      JSON.stringify([
        {
          results: {
            failed_checks: [
              {
                check_id: "CKV_DOCKER_2",
                check_result: { result: "FAILED" },
                file_path: "/Dockerfile",
                file_line_range: [1, 1],
                resource: "Dockerfile",
                guideline: "Add HEALTHCHECK instruction",
              },
            ],
          },
        },
        {
          results: {
            failed_checks: [
              {
                check_id: "CKV_K8S_1",
                check_result: { result: "FAILED" },
                file_path: "/deployment.yaml",
                file_line_range: [5, 20],
                resource: "Deployment.default.app",
              },
            ],
          },
        },
      ]),
    );

    const result = await scanCheckov("/project");
    expect(result.findings).toHaveLength(2);
  });
});

// ── hadolint ───────────────────────────────────────────────────────

describe("scanHadolint", () => {
  it("skips when no Dockerfile found", async () => {
    const { scanHadolint } = await import("../../scanners/hadolint");
    mockExistsSync.mockReturnValue(false);
    const result = await scanHadolint("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("No Dockerfile");
  });

  it("skips when hadolint not found (ENOENT)", async () => {
    const { scanHadolint } = await import("../../scanners/hadolint");
    mockExistsSync.mockImplementation((p) => {
      return String(p).endsWith("Dockerfile");
    });
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanHadolint("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("hadolint not found");
  });

  it("parses hadolint JSON output", async () => {
    const { scanHadolint } = await import("../../scanners/hadolint");
    mockExistsSync.mockImplementation((p) => {
      return String(p).endsWith("Dockerfile");
    });
    mockExecFileSuccess(
      JSON.stringify([
        {
          line: 3,
          code: "DL3008",
          message: "Pin versions in apt-get install",
          column: 1,
          file: "/project/Dockerfile",
          level: "warning",
        },
        {
          line: 7,
          code: "DL3003",
          message: "Use WORKDIR instead of RUN cd",
          column: 1,
          file: "/project/Dockerfile",
          level: "error",
        },
      ]),
    );

    const result = await scanHadolint("/project");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].severity).toBe("MEDIUM");
    expect(result.findings[0].category).toBe("SECURITY");
    expect(result.findings[1].severity).toBe("HIGH");
  });

  it("discovers Dockerfiles in sub-project directories", async () => {
    const { scanHadolint } = await import("../../scanners/hadolint");

    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s === "/project/Dockerfile") return false;
      if (s === "/project/backend/Dockerfile") return true;
      if (s === "/project/frontend/Dockerfile") return true;
      return false;
    });

    mockReaddirSync.mockImplementation((dir) => {
      if (String(dir) === "/project") {
        return [
          { name: "backend", isDirectory: () => true },
          { name: "frontend", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    mockExecFileSuccess(
      JSON.stringify([
        {
          line: 1,
          code: "DL3008",
          message: "Pin versions",
          column: 1,
          file: "/project/backend/Dockerfile",
          level: "warning",
        },
      ]),
    );

    const result = await scanHadolint("/project");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].file).toBe("backend/Dockerfile");
    expect(result.findings[1].file).toBe("frontend/Dockerfile");
  });
});

// ── gitleaks ───────────────────────────────────────────────────────

describe("scanGitleaks", () => {
  it("skips when gitleaks not found (ENOENT)", async () => {
    const { scanGitleaks } = await import("../../scanners/gitleaks");
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanGitleaks("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("gitleaks not found");
  });

  it("parses gitleaks JSON array output", async () => {
    const { scanGitleaks } = await import("../../scanners/gitleaks");
    const jsonOutput = JSON.stringify([
      {
        RuleID: "aws-access-key-id",
        Description: "AWS Access Key ID",
        File: "config.js",
        StartLine: 12,
        EndLine: 12,
        Secret: "AKIA...",
      },
      {
        RuleID: "generic-api-key",
        Description: "Generic API Key",
        File: ".env",
        StartLine: 3,
        EndLine: 3,
        Secret: "sk-...",
      },
    ]);
    // gitleaks exits 1 when leaks found; report is written to temp file
    const execErr = new Error("leaks found") as Error & {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    execErr.status = 1;
    execErr.stdout = "";
    execErr.stderr = "";
    mockExecFileError(execErr as Error & { stdout?: string; stderr?: string; code?: string });
    mockReadFileSync.mockReturnValue(jsonOutput);

    const result = await scanGitleaks("/project");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].severity).toBe("CRITICAL");
    expect(result.findings[0].category).toBe("SECRETS");
    expect(result.findings[1].file).toBe(".env");
  });

  it("returns empty findings on clean scan (exit 0, no report file)", async () => {
    const { scanGitleaks } = await import("../../scanners/gitleaks");
    mockExecFileSuccess("");
    // readFileSync throws because temp file doesn't exist (no leaks → no report written)
    mockReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    const result = await scanGitleaks("/project");
    expect(result.findings).toHaveLength(0);
    expect(result.skipped).toBeUndefined();
  });
});

// ── shellcheck ────────────────────────────────────────────────────

describe("scanShellcheck", () => {
  it("skips when no shell scripts found", async () => {
    const { scanShellcheck } = await import("../../scanners/shellcheck");
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockImplementation(() => {
      return [] as unknown as fs.Dirent[];
    });
    const result = await scanShellcheck("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("No shell scripts");
  });

  it("skips when shellcheck not found (ENOENT)", async () => {
    const { scanShellcheck } = await import("../../scanners/shellcheck");
    const dirent = {
      name: "deploy.sh",
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
    mockReaddirSync.mockImplementation((dir) => {
      if (String(dir) === "/project") return [dirent] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });
    mockExistsSync.mockReturnValue(false);
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanShellcheck("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("shellcheck not found");
  });

  it("parses shellcheck JSON output", async () => {
    const { scanShellcheck } = await import("../../scanners/shellcheck");
    const dirent = {
      name: "deploy.sh",
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    };
    mockReaddirSync.mockImplementation((dir) => {
      if (String(dir) === "/project") return [dirent] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });
    mockExistsSync.mockReturnValue(false);
    mockExecFileSuccess(
      JSON.stringify([
        {
          file: "/project/deploy.sh",
          line: 5,
          column: 1,
          level: "warning",
          code: 2086,
          message: "Double quote to prevent globbing and word splitting.",
        },
        {
          file: "/project/deploy.sh",
          line: 10,
          column: 3,
          level: "error",
          code: 2155,
          message: "Declare and assign separately to avoid masking return values.",
        },
      ]),
    );

    const result = await scanShellcheck("/project");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].severity).toBe("MEDIUM");
    expect(result.findings[0].category).toBe("IAC");
    expect(result.findings[0].message).toContain("SC2086");
    expect(result.findings[1].severity).toBe("HIGH");
    expect(result.findings[1].message).toContain("SC2155");
  });

  it("T5: detects extensionless script with shell shebang", async () => {
    const { scanShellcheck } = await import("../../scanners/shellcheck");
    // Extensionless file that has #!/bin/bash shebang
    const dirent = {
      name: "run-deploy",
      isFile: () => true,
      isSymbolicLink: () => false,
      isDirectory: () => false,
    };
    mockReaddirSync.mockImplementation((dir, opts) => {
      if (String(dir) === "/project") {
        if (opts && typeof opts === "object" && "withFileTypes" in opts) {
          return [dirent] as unknown as fs.Dirent[];
        }
        return ["run-deploy"] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });
    mockExistsSync.mockReturnValue(false);

    // Mock openSync/readSync/closeSync for shebang detection
    const mockOpenSync = vi.mocked(fs.openSync);
    const mockReadSync = vi.mocked(fs.readSync);
    const mockCloseSync = vi.mocked(fs.closeSync);
    mockOpenSync.mockReturnValue(42);
    mockReadSync.mockImplementation((_fd, buf: Buffer) => {
      const shebang = "#!/bin/bash\necho hello\n";
      buf.write(shebang, 0, "utf-8");
      return shebang.length;
    });
    mockCloseSync.mockReturnValue(undefined);

    mockExecFileSuccess(JSON.stringify([]));

    const result = await scanShellcheck("/project");
    expect(result.skipped).toBeFalsy();
    expect(result.tool).toBe("shellcheck");
  });
});

// ── trivy-sbom ──────────────────────────────────────────────────

describe("scanTrivySbom", () => {
  it("skips when trivy not found (ENOENT)", async () => {
    const { scanTrivySbom } = await import("../../scanners/trivy-sbom");
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanTrivySbom("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("trivy not found");
  });

  it("returns CycloneDX SBOM output with no findings", async () => {
    const { scanTrivySbom } = await import("../../scanners/trivy-sbom");
    const cyclonedxJson = JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.4",
      components: [{ type: "library", name: "lodash", version: "4.17.21" }],
    });
    mockExecFileSuccess(cyclonedxJson);

    const result = await scanTrivySbom("/project");
    expect(result.findings).toHaveLength(0);
    expect(result.sbomOutput).toBe(cyclonedxJson);
    expect(result.tool).toBe("trivy-sbom");
    expect(result.skipped).toBeUndefined();
  });

  it("returns sbomOutput even when trivy exits non-zero", async () => {
    const { scanTrivySbom } = await import("../../scanners/trivy-sbom");
    const cyclonedxJson = '{"bomFormat":"CycloneDX"}';
    const err = Object.assign(new Error("exit 1"), {
      stdout: cyclonedxJson,
      stderr: "",
      status: 1,
    });
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });

    const result = await scanTrivySbom("/project");
    expect(result.sbomOutput).toBe(cyclonedxJson);
    expect(result.findings).toHaveLength(0);
  });
});

// ── semgrep ──────────────────────────────────────────────────────

describe("scanSemgrep", () => {
  it("skips when semgrep not found (ENOENT)", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanSemgrep("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("semgrep not found");
  });

  it("skips on execution failure with no stdout", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    const err = Object.assign(new Error("exec fail"), {
      stdout: "",
      stderr: "error running semgrep",
    });
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });
    const result = await scanSemgrep("/project");
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("semgrep failed");
  });

  it("parses semgrep JSON output", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    mockExecFileSuccess(
      JSON.stringify({
        results: [
          {
            check_id: "python.lang.security.audit.exec-detected",
            path: "app.py",
            start: { line: 42, col: 1 },
            end: { line: 42, col: 20 },
            extra: {
              message:
                "Detected the use of exec(). Avoid using exec() as it can lead to code injection.",
              severity: "ERROR",
              metadata: {
                cwe: ["CWE-94"],
                owasp: ["A03:2021"],
              },
            },
          },
          {
            check_id: "javascript.lang.security.detect-eval",
            path: "src/index.js",
            start: { line: 10, col: 5 },
            end: { line: 10, col: 30 },
            extra: {
              message:
                "Detected the use of eval(). Avoid using eval() as it can lead to code injection.",
              severity: "WARNING",
              metadata: {
                cwe: ["CWE-95"],
                references: ["https://owasp.org/Top10/A03_2021-Injection/"],
              },
              fix: "Use JSON.parse() instead",
            },
          },
        ],
        errors: [],
      }),
    );

    const result = await scanSemgrep("/project");
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toHaveLength(2);

    const [f1, f2] = result.findings;
    expect(f1.tool).toBe("semgrep");
    expect(f1.severity).toBe("HIGH"); // ERROR → HIGH
    expect(f1.file).toBe("app.py");
    expect(f1.line).toBe(42);
    expect(f1.cwe).toBe("CWE-94");
    expect(f1.autoFixAvailable).toBe(false);

    expect(f2.severity).toBe("MEDIUM"); // WARNING → MEDIUM
    expect(f2.file).toBe("src/index.js");
    expect(f2.autoFixAvailable).toBe(true);
    expect(f2.recommendation).toContain("Suggested fix");
  });

  it("parses results from non-zero exit (semgrep exits 1 when findings exist)", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    const output = JSON.stringify({
      results: [
        {
          check_id: "generic.secrets.gitleaks.generic-api-key",
          path: "config.yaml",
          start: { line: 5, col: 1 },
          end: { line: 5, col: 40 },
          extra: {
            message: "Generic API key detected",
            severity: "WARNING",
            metadata: {},
          },
        },
      ],
      errors: [],
    });
    const err = Object.assign(new Error("exit 1"), {
      stdout: output,
      stderr: "",
      status: 1,
    });
    mockExecFileError(err as Error & { stdout?: string; stderr?: string; code?: string });

    const result = await scanSemgrep("/project");
    expect(result.skipped).toBeUndefined();
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].tool).toBe("semgrep");
  });

  it("returns empty findings when no results", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    mockExecFileSuccess(JSON.stringify({ results: [], errors: [] }));
    const result = await scanSemgrep("/project");
    expect(result.findings).toHaveLength(0);
    expect(result.skipped).toBeUndefined();
  });

  it("handles malformed JSON output", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    mockExecFileSuccess("not valid json");
    const result = await scanSemgrep("/project");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toContain("Failed to parse");
  });

  it("uses deterministic finding IDs", async () => {
    const { scanSemgrep } = await import("../../scanners/semgrep");
    const output = JSON.stringify({
      results: [
        {
          check_id: "python.lang.security.audit.exec-detected",
          path: "app.py",
          start: { line: 42, col: 1 },
          end: { line: 42, col: 20 },
          extra: {
            message: "Detected exec()",
            severity: "ERROR",
          },
        },
      ],
      errors: [],
    });
    mockExecFileSuccess(output);

    const result1 = await scanSemgrep("/project");
    mockExecFileSuccess(output);
    const result2 = await scanSemgrep("/project");

    expect(result1.findings[0].id).toBe(result2.findings[0].id);
    expect(result1.findings[0].id).toMatch(/^semgrep-/);
  });
});
