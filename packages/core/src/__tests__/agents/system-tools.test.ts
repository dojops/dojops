import { describe, it, expect } from "vitest";
import {
  findSystemTool,
  buildDownloadUrl,
  buildBinaryPathInArchive,
  isToolSupportedOnCurrentPlatform,
  SYSTEM_TOOLS,
  BINARY_TO_SYSTEM_TOOL,
  type ArchiveType,
} from "../../agents/system-tools";

/** Look up a tool by name and assert it exists with expected properties. */
function expectToolProps(
  name: string,
  props: {
    archiveType?: ArchiveType;
    binaryName?: string;
    binaryPathInArchive?: string | null; // null = expect undefined, string = expect toContain
  },
): void {
  const tool = findSystemTool(name);
  expect(tool).toBeDefined();
  if (props.archiveType) expect(tool!.archiveType).toBe(props.archiveType);
  if (props.binaryName) expect(tool!.binaryName).toBe(props.binaryName);
  if (props.binaryPathInArchive === null) {
    expect(tool!.binaryPathInArchive).toBeUndefined();
  } else if (props.binaryPathInArchive) {
    expect(tool!.binaryPathInArchive).toContain(props.binaryPathInArchive);
  }
}

/** Build a download URL for a tool and assert it contains all expected substrings. */
function expectDownloadUrl(name: string, version: string, expectedSubstrings: string[]): void {
  const tool = findSystemTool(name)!;
  const url = buildDownloadUrl(tool, version);
  expect(url).toBeDefined();
  for (const sub of expectedSubstrings) {
    expect(url).toContain(sub);
  }
}

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
      expectDownloadUrl("terraform", "1.14.6", ["1.14.6", "releases.hashicorp.com/terraform"]);
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
      expectDownloadUrl("trivy", "0.69.3", ["aquasecurity/trivy", "0.69.3", ".tar.gz"]);
    });

    it("interpolates gitleaks URL correctly", () => {
      expectDownloadUrl("gitleaks", "8.30.0", ["gitleaks/gitleaks", "8.30.0", ".tar.gz"]);
    });
  });

  describe("buildBinaryPathInArchive", () => {
    it("returns interpolated path for gh", () => {
      const tool = findSystemTool("gh")!;
      const archivePath = buildBinaryPathInArchive(tool, "2.87.3");
      expect(archivePath).toBeDefined();
      expect(archivePath).toContain("2.87.3");
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
      expectToolProps("helm", { archiveType: "tar.gz", binaryName: "helm" });
      expect(findSystemTool("helm")!.binaryPathInArchive).toBeDefined();
    });

    it("finds shellcheck with tar.xz archive", () => {
      expectToolProps("shellcheck", {
        archiveType: "tar.xz",
        binaryName: "shellcheck",
        binaryPathInArchive: "shellcheck",
      });
    });

    it("finds actionlint", () => {
      expectToolProps("actionlint", {
        archiveType: "tar.gz",
        binaryName: "actionlint",
        binaryPathInArchive: null,
      });
    });

    it("finds promtool", () => {
      expectToolProps("promtool", {
        archiveType: "tar.gz",
        binaryName: "promtool",
        binaryPathInArchive: "promtool",
      });
    });

    it("finds circleci", () => {
      expectToolProps("circleci", {
        archiveType: "tar.gz",
        binaryName: "circleci",
        binaryPathInArchive: "circleci",
      });
    });

    it("builds correct helm download URL", () => {
      expectDownloadUrl("helm", "4.1.1", ["get.helm.sh", "4.1.1", ".tar.gz"]);
    });

    it("builds correct shellcheck download URL", () => {
      expectDownloadUrl("shellcheck", "0.11.0", ["koalaman/shellcheck", "0.11.0", ".tar.xz"]);
    });

    it("builds correct actionlint download URL", () => {
      expectDownloadUrl("actionlint", "1.7.11", ["rhysd/actionlint", "1.7.11", ".tar.gz"]);
    });

    it("builds correct promtool download URL", () => {
      expectDownloadUrl("promtool", "3.10.0", ["prometheus/prometheus", "3.10.0"]);
    });

    it("builds correct circleci download URL", () => {
      expectDownloadUrl("circleci", "0.1.34770", ["CircleCI-Public/circleci-cli", "0.1.34770"]);
    });
  });

  describe("BINARY_TO_SYSTEM_TOOL mapping", () => {
    it("maps ansible companion binaries to ansible tool", () => {
      expect(BINARY_TO_SYSTEM_TOOL["ansible-playbook"]).toBe("ansible");
      expect(BINARY_TO_SYSTEM_TOOL["ansible-lint"]).toBe("ansible");
      expect(BINARY_TO_SYSTEM_TOOL["ansible-galaxy"]).toBe("ansible");
      expect(BINARY_TO_SYSTEM_TOOL["ansible-vault"]).toBe("ansible");
    });

    it("maps direct binaries to their tool names", () => {
      expect(BINARY_TO_SYSTEM_TOOL["terraform"]).toBe("terraform");
      expect(BINARY_TO_SYSTEM_TOOL["kubectl"]).toBe("kubectl");
      expect(BINARY_TO_SYSTEM_TOOL["helm"]).toBe("helm");
      expect(BINARY_TO_SYSTEM_TOOL["hadolint"]).toBe("hadolint");
      expect(BINARY_TO_SYSTEM_TOOL["actionlint"]).toBe("actionlint");
    });

    it("all mapped tool names exist in SYSTEM_TOOLS", () => {
      const toolNames = new Set(SYSTEM_TOOLS.map((t) => t.name));
      for (const toolName of Object.values(BINARY_TO_SYSTEM_TOOL)) {
        expect(toolNames.has(toolName)).toBe(true);
      }
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
