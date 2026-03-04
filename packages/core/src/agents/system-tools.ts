/**
 * System tool definitions and pure helper functions.
 *
 * Data-only — no I/O, no child_process, no TUI.
 * Runtime install/download lives in @dojops/cli (tool-sandbox.ts).
 */

import os from "node:os";

export type Platform = "linux" | "darwin" | "win32";
export type Arch = "x64" | "arm64";
export type ArchiveType = "zip" | "tar.gz" | "tar.xz" | "standalone" | "pipx";

export interface SystemTool {
  name: string;
  description: string;
  latestVersion: string;
  archiveType: ArchiveType;
  binaryName: string;
  verifyCommand: string[];
  urlTemplate: string;
  platformMap: Record<Platform, string>;
  archMap: Record<Arch, string>;
  supportedTargets: Array<{ platform: Platform; arch: Arch }>;
  binaryPathInArchive?: string;
  /** SHA-256 checksums keyed by version string. Used to verify downloaded binaries. */
  sha256?: Record<string, string>;
}

export interface InstalledTool {
  name: string;
  version: string;
  installedAt: string;
  size: number;
  binaryPath: string;
}

export interface ToolRegistry {
  tools: InstalledTool[];
  updatedAt: string;
}

export const SYSTEM_TOOLS: SystemTool[] = [
  {
    name: "terraform",
    description:
      "Infrastructure as Code tool for building, changing, and versioning infrastructure",
    latestVersion: "1.10.5",
    archiveType: "zip",
    binaryName: "terraform",
    verifyCommand: ["terraform", "--version"],
    urlTemplate:
      "https://releases.hashicorp.com/terraform/{{version}}/terraform_{{version}}_{{platform}}_{{arch}}.zip",
    platformMap: { linux: "linux", darwin: "darwin", win32: "windows" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
      { platform: "win32", arch: "x64" },
    ],
  },
  {
    name: "kubectl",
    description: "Kubernetes command-line tool for cluster management",
    latestVersion: "1.32.1",
    archiveType: "standalone",
    binaryName: "kubectl",
    verifyCommand: ["kubectl", "version", "--client"],
    urlTemplate: "https://dl.k8s.io/release/v{{version}}/bin/{{platform}}/{{arch}}/kubectl",
    platformMap: { linux: "linux", darwin: "darwin", win32: "windows" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
  },
  {
    name: "gh",
    description: "GitHub CLI for repository and workflow management",
    latestVersion: "2.65.0",
    archiveType: "tar.gz",
    binaryName: "gh",
    verifyCommand: ["gh", "--version"],
    urlTemplate:
      "https://github.com/cli/cli/releases/download/v{{version}}/gh_{{version}}_{{platform}}_{{arch}}.tar.gz",
    platformMap: { linux: "linux", darwin: "macOS", win32: "windows" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
    binaryPathInArchive: "gh_{{version}}_{{platform}}_{{arch}}/bin/gh",
  },
  {
    name: "hadolint",
    description: "Dockerfile linter for best practice validation",
    latestVersion: "2.12.0",
    archiveType: "standalone",
    binaryName: "hadolint",
    verifyCommand: ["hadolint", "--version"],
    urlTemplate:
      "https://github.com/hadolint/hadolint/releases/download/v{{version}}/hadolint-{{platform}}-{{arch}}",
    platformMap: { linux: "Linux", darwin: "Darwin", win32: "Windows" },
    archMap: { x64: "x86_64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
  },
  {
    name: "trivy",
    description:
      "Comprehensive security scanner for vulnerabilities, misconfigurations, and secrets",
    latestVersion: "0.69.1",
    archiveType: "tar.gz",
    binaryName: "trivy",
    verifyCommand: ["trivy", "--version"],
    urlTemplate:
      "https://github.com/aquasecurity/trivy/releases/download/v{{version}}/trivy_{{version}}_{{platform}}-{{arch}}.tar.gz",
    platformMap: { linux: "Linux", darwin: "macOS", win32: "Windows" },
    archMap: { x64: "64bit", arm64: "ARM64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
  },
  {
    name: "gitleaks",
    description: "Secret detection tool for scanning repositories for hardcoded credentials",
    latestVersion: "8.30.0",
    archiveType: "tar.gz",
    binaryName: "gitleaks",
    verifyCommand: ["gitleaks", "version"],
    urlTemplate:
      "https://github.com/gitleaks/gitleaks/releases/download/v{{version}}/gitleaks_{{version}}_{{platform}}_{{arch}}.tar.gz",
    platformMap: { linux: "linux", darwin: "darwin", win32: "windows" },
    archMap: { x64: "x64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
  },
  {
    name: "ansible",
    description: "IT automation tool for configuration management and deployment",
    latestVersion: "11.1.0",
    archiveType: "pipx",
    binaryName: "ansible",
    verifyCommand: ["ansible", "--version"],
    urlTemplate: "",
    platformMap: { linux: "linux", darwin: "darwin", win32: "win32" },
    archMap: { x64: "x64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
  },
  {
    name: "helm",
    description: "Kubernetes package manager for deploying and managing applications",
    latestVersion: "3.17.3",
    archiveType: "tar.gz",
    binaryName: "helm",
    verifyCommand: ["helm", "version", "--short"],
    urlTemplate: "https://get.helm.sh/helm-v{{version}}-{{platform}}-{{arch}}.tar.gz",
    platformMap: { linux: "linux", darwin: "darwin", win32: "windows" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
    binaryPathInArchive: "{{platform}}-{{arch}}/helm",
  },
  {
    name: "shellcheck",
    description: "Static analysis tool for shell scripts",
    latestVersion: "0.10.0",
    archiveType: "tar.xz",
    binaryName: "shellcheck",
    verifyCommand: ["shellcheck", "--version"],
    urlTemplate:
      "https://github.com/koalaman/shellcheck/releases/download/v{{version}}/shellcheck-v{{version}}.{{platform}}.{{arch}}.tar.xz",
    platformMap: { linux: "linux", darwin: "darwin", win32: "win32" },
    archMap: { x64: "x86_64", arm64: "aarch64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
    binaryPathInArchive: "shellcheck-v{{version}}/shellcheck",
  },
  {
    name: "actionlint",
    description: "Static checker for GitHub Actions workflow files",
    latestVersion: "1.7.7",
    archiveType: "tar.gz",
    binaryName: "actionlint",
    verifyCommand: ["actionlint", "--version"],
    urlTemplate:
      "https://github.com/rhysd/actionlint/releases/download/v{{version}}/actionlint_{{version}}_{{platform}}_{{arch}}.tar.gz",
    platformMap: { linux: "linux", darwin: "darwin", win32: "windows" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
  },
  {
    name: "promtool",
    description: "Prometheus configuration and rules validation tool",
    latestVersion: "2.55.1",
    archiveType: "tar.gz",
    binaryName: "promtool",
    verifyCommand: ["promtool", "--version"],
    urlTemplate:
      "https://github.com/prometheus/prometheus/releases/download/v{{version}}/prometheus-{{version}}.{{platform}}-{{arch}}.tar.gz",
    platformMap: { linux: "linux", darwin: "darwin", win32: "win32" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
    binaryPathInArchive: "prometheus-{{version}}.{{platform}}-{{arch}}/promtool",
  },
  {
    name: "circleci",
    description: "CircleCI CLI for configuration validation and local execution",
    latestVersion: "0.1.31364",
    archiveType: "tar.gz",
    binaryName: "circleci",
    verifyCommand: ["circleci", "version"],
    urlTemplate:
      "https://github.com/CircleCI-Public/circleci-cli/releases/download/v{{version}}/circleci-cli_{{version}}_{{platform}}_{{arch}}.tar.gz",
    platformMap: { linux: "linux", darwin: "darwin", win32: "win32" },
    archMap: { x64: "amd64", arm64: "arm64" },
    supportedTargets: [
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "arm64" },
      { platform: "darwin", arch: "x64" },
      { platform: "darwin", arch: "arm64" },
    ],
    binaryPathInArchive: "circleci-cli_{{version}}_{{platform}}_{{arch}}/circleci",
  },
];

/**
 * Find a system tool definition by name (case-insensitive).
 */
export function findSystemTool(name: string): SystemTool | undefined {
  return SYSTEM_TOOLS.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

/**
 * Check if a tool supports the current platform and architecture.
 */
export function isToolSupportedOnCurrentPlatform(tool: SystemTool): boolean {
  const platform = os.platform() as string;
  const arch = os.arch() as string;
  return tool.supportedTargets.some((t) => t.platform === platform && t.arch === arch);
}

/**
 * Interpolate placeholders in a template string.
 */
function interpolate(template: string, tool: SystemTool, version: string): string {
  const platform = os.platform() as Platform;
  const arch = os.arch() as Arch;
  const mappedPlatform = tool.platformMap[platform] ?? platform;
  const mappedArch = tool.archMap[arch] ?? arch;

  return template
    .replace(/\{\{version\}\}/g, version)
    .replace(/\{\{platform\}\}/g, mappedPlatform)
    .replace(/\{\{arch\}\}/g, mappedArch);
}

/**
 * Build the download URL for a system tool.
 * Returns undefined for pipx tools (no binary download).
 */
export function buildDownloadUrl(tool: SystemTool, version?: string): string | undefined {
  if (tool.archiveType === "pipx") return undefined;
  if (!tool.urlTemplate) return undefined;
  return interpolate(tool.urlTemplate, tool, version ?? tool.latestVersion);
}

/**
 * Build the path to the binary inside an archive.
 * Returns undefined if tool has no nested binary path.
 */
export function buildBinaryPathInArchive(tool: SystemTool, version?: string): string | undefined {
  if (!tool.binaryPathInArchive) return undefined;
  return interpolate(tool.binaryPathInArchive, tool, version ?? tool.latestVersion);
}
