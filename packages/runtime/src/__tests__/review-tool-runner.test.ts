import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReviewToolSpec } from "@dojops/core";

// Mock @dojops/sdk's runBin before importing the module under test
vi.mock("@dojops/sdk", () => ({
  runBin: vi.fn(),
}));

import { runReviewTool, runReviewTools } from "../review-tool-runner";
import { runBin } from "@dojops/sdk";

const mockedRunBin = vi.mocked(runBin);

const actionlintSpec: ReviewToolSpec = {
  patterns: [".github/workflows/*.yml"],
  binary: "actionlint",
  args: ["{file}"],
  parser: "actionlint",
  description: "GitHub Actions workflow validation",
};

const hadolintSpec: ReviewToolSpec = {
  patterns: ["Dockerfile"],
  binary: "hadolint",
  args: ["--format", "json", "{file}"],
  parser: "hadolint-json",
  description: "Dockerfile linting",
};

const disallowedSpec: ReviewToolSpec = {
  patterns: ["*.txt"],
  binary: "not-allowed-binary",
  args: ["{file}"],
  description: "Not allowed",
};

describe("runReviewTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped result for disallowed binaries", () => {
    const result = runReviewTool("test.txt", disallowedSpec, "/project");
    expect(result.passed).toBe(true);
    expect(result.issues[0].severity).toBe("info");
    expect(result.issues[0].message).toContain("not in allowed binaries");
  });

  it("returns passed result when tool exits cleanly with no output", () => {
    mockedRunBin.mockReturnValue("");
    const result = runReviewTool(".github/workflows/ci.yml", actionlintSpec, "/project");
    expect(result.passed).toBe(true);
    expect(result.tool).toBe("actionlint");
    expect(result.file).toBe(".github/workflows/ci.yml");
    expect(result.issues).toHaveLength(0);
  });

  it("passes correct args with {file} replaced", () => {
    mockedRunBin.mockReturnValue("");
    runReviewTool("Dockerfile", hadolintSpec, "/project");

    expect(mockedRunBin).toHaveBeenCalledWith(
      "hadolint",
      ["--format", "json", "/project/Dockerfile"],
      expect.objectContaining({
        encoding: "utf-8",
        cwd: "/project",
      }),
    );
  });

  it("parses actionlint output with issues", () => {
    mockedRunBin.mockImplementation(() => {
      const err = new Error("exit 1") as Error & {
        stdout: string;
        stderr: string;
      };
      err.stdout =
        ".github/workflows/ci.yml:15:3: shellcheck reported issue in this script: SC2086 [shellcheck]";
      err.stderr = "";
      throw err;
    });

    const result = runReviewTool(".github/workflows/ci.yml", actionlintSpec, "/project");
    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("returns skipped result when binary is not installed (ENOENT)", () => {
    mockedRunBin.mockImplementation(() => {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    const result = runReviewTool(".github/workflows/ci.yml", actionlintSpec, "/project");
    expect(result.passed).toBe(true);
    expect(result.issues[0].severity).toBe("info");
    expect(result.issues[0].message).toContain("not installed");
  });

  it("uses custom timeout from spec", () => {
    mockedRunBin.mockReturnValue("");
    const specWithTimeout = { ...actionlintSpec, timeout: 60000 };
    runReviewTool(".github/workflows/ci.yml", specWithTimeout, "/project");

    expect(mockedRunBin).toHaveBeenCalledWith(
      "actionlint",
      expect.any(Array),
      expect.objectContaining({ timeout: 60000 }),
    );
  });

  it("replaces {dir} in args", () => {
    mockedRunBin.mockReturnValue("");
    const helmSpec: ReviewToolSpec = {
      patterns: ["Chart.yaml"],
      binary: "helm",
      args: ["lint", "{dir}"],
      description: "Helm lint",
    };

    runReviewTool("charts/my-app/Chart.yaml", helmSpec, "/project");
    expect(mockedRunBin).toHaveBeenCalledWith(
      "helm",
      ["lint", "/project/charts/my-app"],
      expect.any(Object),
    );
  });
});

describe("runReviewTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRunBin.mockReturnValue("");
  });

  it("runs all entries and returns results", () => {
    const entries = [
      { filePath: ".github/workflows/ci.yml", spec: actionlintSpec },
      { filePath: "Dockerfile", spec: hadolintSpec },
    ];

    const results = runReviewTools(entries, "/project");
    expect(results).toHaveLength(2);
    expect(results[0].tool).toBe("actionlint");
    expect(results[1].tool).toBe("hadolint");
  });

  it("returns empty array for empty entries", () => {
    const results = runReviewTools([], "/project");
    expect(results).toHaveLength(0);
  });
});
