import { describe, it, expect } from "vitest";
import {
  findSystemTool,
  buildDownloadUrl,
  buildBinaryPathInArchive,
  isToolSupportedOnCurrentPlatform,
  SYSTEM_TOOLS,
} from "../../agents/system-tools";

describe("system-tools", () => {
  describe("findSystemTool", () => {
    it("finds a tool by exact name", () => {
      const tool = findSystemTool("terraform");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("terraform");
    });

    it("finds a tool case-insensitively", () => {
      const tool = findSystemTool("Terraform");
      expect(tool).toBeDefined();
      expect(tool!.name).toBe("terraform");
    });

    it("returns undefined for unknown tool", () => {
      expect(findSystemTool("nonexistent")).toBeUndefined();
    });
  });

  describe("buildDownloadUrl", () => {
    it("interpolates terraform URL with version, platform, and arch", () => {
      const tool = findSystemTool("terraform")!;
      const url = buildDownloadUrl(tool, "1.10.5");
      expect(url).toBeDefined();
      expect(url).toContain("1.10.5");
      expect(url).toContain("releases.hashicorp.com/terraform");
    });

    it("uses latestVersion when no version specified", () => {
      const tool = findSystemTool("kubectl")!;
      const url = buildDownloadUrl(tool);
      expect(url).toBeDefined();
      expect(url).toContain(tool.latestVersion);
    });

    it("returns undefined for pipx tools", () => {
      const tool = findSystemTool("ansible")!;
      expect(buildDownloadUrl(tool)).toBeUndefined();
    });

    it("interpolates trivy URL correctly", () => {
      const tool = findSystemTool("trivy")!;
      const url = buildDownloadUrl(tool, "0.69.1");
      expect(url).toBeDefined();
      expect(url).toContain("aquasecurity/trivy");
      expect(url).toContain("0.69.1");
      expect(url).toContain(".tar.gz");
    });

    it("interpolates gitleaks URL correctly", () => {
      const tool = findSystemTool("gitleaks")!;
      const url = buildDownloadUrl(tool, "8.30.0");
      expect(url).toBeDefined();
      expect(url).toContain("gitleaks/gitleaks");
      expect(url).toContain("8.30.0");
      expect(url).toContain(".tar.gz");
    });
  });

  describe("buildBinaryPathInArchive", () => {
    it("returns interpolated path for gh", () => {
      const tool = findSystemTool("gh")!;
      const archivePath = buildBinaryPathInArchive(tool, "2.65.0");
      expect(archivePath).toBeDefined();
      expect(archivePath).toContain("2.65.0");
      expect(archivePath).toContain("/bin/gh");
    });

    it("returns undefined for tools without nested archive path", () => {
      const tool = findSystemTool("terraform")!;
      expect(buildBinaryPathInArchive(tool)).toBeUndefined();
    });
  });

  describe("isToolSupportedOnCurrentPlatform", () => {
    it("returns true for terraform on current platform", () => {
      // terraform supports linux/x64 which is the test environment
      const tool = findSystemTool("terraform")!;
      expect(isToolSupportedOnCurrentPlatform(tool)).toBe(true);
    });
  });

  describe("new system tools", () => {
    it("finds helm", () => {
      const tool = findSystemTool("helm");
      expect(tool).toBeDefined();
      expect(tool!.archiveType).toBe("tar.gz");
      expect(tool!.binaryName).toBe("helm");
      expect(tool!.binaryPathInArchive).toBeDefined();
    });

    it("finds shellcheck with tar.xz archive", () => {
      const tool = findSystemTool("shellcheck");
      expect(tool).toBeDefined();
      expect(tool!.archiveType).toBe("tar.xz");
      expect(tool!.binaryName).toBe("shellcheck");
      expect(tool!.binaryPathInArchive).toContain("shellcheck");
    });

    it("finds actionlint", () => {
      const tool = findSystemTool("actionlint");
      expect(tool).toBeDefined();
      expect(tool!.archiveType).toBe("tar.gz");
      expect(tool!.binaryName).toBe("actionlint");
      expect(tool!.binaryPathInArchive).toBeUndefined();
    });

    it("finds promtool", () => {
      const tool = findSystemTool("promtool");
      expect(tool).toBeDefined();
      expect(tool!.archiveType).toBe("tar.gz");
      expect(tool!.binaryName).toBe("promtool");
      expect(tool!.binaryPathInArchive).toContain("promtool");
    });

    it("finds circleci", () => {
      const tool = findSystemTool("circleci");
      expect(tool).toBeDefined();
      expect(tool!.archiveType).toBe("tar.gz");
      expect(tool!.binaryName).toBe("circleci");
      expect(tool!.binaryPathInArchive).toContain("circleci");
    });

    it("builds correct helm download URL", () => {
      const tool = findSystemTool("helm")!;
      const url = buildDownloadUrl(tool, "3.17.3");
      expect(url).toBeDefined();
      expect(url).toContain("get.helm.sh");
      expect(url).toContain("3.17.3");
      expect(url).toContain(".tar.gz");
    });

    it("builds correct shellcheck download URL", () => {
      const tool = findSystemTool("shellcheck")!;
      const url = buildDownloadUrl(tool, "0.10.0");
      expect(url).toBeDefined();
      expect(url).toContain("koalaman/shellcheck");
      expect(url).toContain("0.10.0");
      expect(url).toContain(".tar.xz");
    });

    it("builds correct actionlint download URL", () => {
      const tool = findSystemTool("actionlint")!;
      const url = buildDownloadUrl(tool, "1.7.7");
      expect(url).toBeDefined();
      expect(url).toContain("rhysd/actionlint");
      expect(url).toContain("1.7.7");
      expect(url).toContain(".tar.gz");
    });

    it("builds correct promtool download URL", () => {
      const tool = findSystemTool("promtool")!;
      const url = buildDownloadUrl(tool, "2.55.1");
      expect(url).toBeDefined();
      expect(url).toContain("prometheus/prometheus");
      expect(url).toContain("2.55.1");
    });

    it("builds correct circleci download URL", () => {
      const tool = findSystemTool("circleci")!;
      const url = buildDownloadUrl(tool, "0.1.31364");
      expect(url).toBeDefined();
      expect(url).toContain("CircleCI-Public/circleci-cli");
      expect(url).toContain("0.1.31364");
    });
  });

  describe("SYSTEM_TOOLS registry", () => {
    it("contains 12 tool definitions", () => {
      expect(SYSTEM_TOOLS).toHaveLength(12);
    });

    it("all tools have required fields", () => {
      for (const tool of SYSTEM_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.latestVersion).toBeTruthy();
        expect(tool.binaryName).toBeTruthy();
        expect(tool.verifyCommand.length).toBeGreaterThan(0);
        expect(tool.supportedTargets.length).toBeGreaterThan(0);
      }
    });

    it("includes tar.xz as a valid archive type", () => {
      const tarXzTools = SYSTEM_TOOLS.filter((t) => t.archiveType === "tar.xz");
      expect(tarXzTools.length).toBeGreaterThan(0);
      expect(tarXzTools[0].name).toBe("shellcheck");
    });
  });
});
