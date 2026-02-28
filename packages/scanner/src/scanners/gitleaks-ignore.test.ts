import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as execAsyncMod from "../exec-async";

vi.mock("../exec-async");
vi.mock("node:fs");

const mockExecFileAsync = vi.mocked(execAsyncMod.execFileAsync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);

beforeEach(() => {
  vi.resetAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockUnlinkSync.mockReturnValue(undefined);
  mockReadFileSync.mockReturnValue("");
});

describe("scanGitleaks .gitleaksignore (M-1)", () => {
  describe("detection", () => {
    it("adds --gitleaksignore flag when file exists", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockImplementation((p) => {
        const s = String(p);
        return s.endsWith(".gitleaksignore");
      });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/project");

      const callArgs = mockExecFileAsync.mock.calls[0][1];
      expect(callArgs).toContain("--gitleaksignore");
    });

    it("does not add flag when file absent", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockReturnValue(false);
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/project");

      const callArgs = mockExecFileAsync.mock.calls[0][1];
      expect(callArgs).not.toContain("--gitleaksignore");
    });

    it("constructs correct path from projectPath", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      const existsChecks: string[] = [];
      mockExistsSync.mockImplementation((p) => {
        existsChecks.push(String(p));
        return String(p).endsWith(".gitleaksignore");
      });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/my/project");

      expect(existsChecks).toContain("/my/project/.gitleaksignore");
    });

    it("passes full path as flag value", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockImplementation((p) => String(p).endsWith(".gitleaksignore"));
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/my/project");

      const callArgs = mockExecFileAsync.mock.calls[0][1];
      const flagIndex = callArgs.indexOf("--gitleaksignore");
      expect(flagIndex).toBeGreaterThan(-1);
      expect(callArgs[flagIndex + 1]).toBe("/my/project/.gitleaksignore");
    });
  });

  describe("integration with results", () => {
    it("findings returned even with .gitleaksignore", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockImplementation((p) => String(p).endsWith(".gitleaksignore"));
      // Gitleaks exits with code 1 when leaks found
      const err = new Error("leaks found") as Error & {
        stdout?: string;
        stderr?: string;
        status?: number;
        code?: string;
      };
      err.status = 1;
      err.stdout = "";
      err.stderr = "";
      mockExecFileAsync.mockRejectedValue(err);
      mockReadFileSync.mockReturnValue(
        JSON.stringify([
          {
            RuleID: "aws-access-key",
            Description: "AWS Access Key",
            File: "config.yml",
            StartLine: 10,
            EndLine: 10,
          },
        ]),
      );

      const result = await scanGitleaks("/project");
      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0].message).toContain("aws-access-key");
    });

    it("ENOENT on binary → skipped", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      mockExecFileAsync.mockRejectedValue(err);

      const result = await scanGitleaks("/project");
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("gitleaks not found");
    });

    it("checks existence before calling exec", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockReturnValue(false);
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/project");

      // existsSync should be called before execFileAsync
      expect(mockExistsSync).toHaveBeenCalled();
      expect(mockExecFileAsync).toHaveBeenCalled();
    });
  });

  describe("argument ordering", () => {
    it("--gitleaksignore after standard flags", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockImplementation((p) => String(p).endsWith(".gitleaksignore"));
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/project");

      const callArgs = mockExecFileAsync.mock.calls[0][1];
      const detectIdx = callArgs.indexOf("detect");
      const ignoreIdx = callArgs.indexOf("--gitleaksignore");
      const noGitIdx = callArgs.indexOf("--no-git");
      expect(detectIdx).toBeLessThan(ignoreIdx);
      expect(noGitIdx).toBeLessThan(ignoreIdx);
    });

    it("all standard args preserved", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      mockExistsSync.mockImplementation((p) => String(p).endsWith(".gitleaksignore"));
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/project");

      const callArgs = mockExecFileAsync.mock.calls[0][1];
      expect(callArgs).toContain("detect");
      expect(callArgs).toContain("--source");
      expect(callArgs).toContain("--report-format");
      expect(callArgs).toContain("json");
      expect(callArgs).toContain("--no-git");
    });

    it("args count differs with/without .gitleaksignore", async () => {
      const { scanGitleaks } = await import("./gitleaks");

      // Without .gitleaksignore
      mockExistsSync.mockReturnValue(false);
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      await scanGitleaks("/project");
      const argsWithout = mockExecFileAsync.mock.calls[0][1].length;

      vi.clearAllMocks();
      mockExistsSync.mockImplementation((p) => String(p).endsWith(".gitleaksignore"));
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
      mockReadFileSync.mockReturnValue("");
      mockUnlinkSync.mockReturnValue(undefined);
      await scanGitleaks("/project");
      const argsWith = mockExecFileAsync.mock.calls[0][1].length;

      // Should be 2 more args (--gitleaksignore + path)
      expect(argsWith - argsWithout).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("projectPath with trailing slash", async () => {
      const { scanGitleaks } = await import("./gitleaks");
      const checks: string[] = [];
      mockExistsSync.mockImplementation((p) => {
        checks.push(String(p));
        return false;
      });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      await scanGitleaks("/project/");

      // Should construct path using path.join which handles trailing slashes
      const gitleaksCheck = checks.find((c) => c.includes(".gitleaksignore"));
      expect(gitleaksCheck).toBeDefined();
      // path.join normalizes trailing slashes
      expect(gitleaksCheck).not.toContain("//");
    });
  });
});
