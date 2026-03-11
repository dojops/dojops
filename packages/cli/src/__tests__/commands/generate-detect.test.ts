import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discoverUserDopsFiles from @dojops/module-registry
const mockDiscoverUserDopsFiles = vi.fn();
vi.mock("@dojops/module-registry", () => ({
  createToolRegistry: vi.fn(),
  discoverUserDopsFiles: (...args: unknown[]) => mockDiscoverUserDopsFiles(...args),
}));

import { autoDetectModule, autoDetectInstalledModule } from "../../commands/generate";

describe("autoDetectModule", () => {
  it("detects github-actions from prompt", () => {
    expect(autoDetectModule("Create a GitHub Actions workflow")).toBe("github-actions");
  });

  it("detects terraform from prompt", () => {
    expect(autoDetectModule("Create Terraform config for AWS")).toBe("terraform");
  });

  it("detects kubernetes from prompt", () => {
    expect(autoDetectModule("Create k8s deployment")).toBe("kubernetes");
  });

  it("detects jenkinsfile from prompt", () => {
    expect(autoDetectModule("Create a Jenkinsfile pipeline")).toBe("jenkinsfile");
  });

  it("returns undefined for unrecognized prompts", () => {
    expect(autoDetectModule("How do I deploy my app?")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(autoDetectModule("Create a DOCKERFILE")).toBe("dockerfile");
  });
});

describe("autoDetectInstalledModule", () => {
  beforeEach(() => {
    mockDiscoverUserDopsFiles.mockReset();
  });

  it("detects installed module by name match", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/circleci.dops", location: "project" },
    ]);

    const result = autoDetectInstalledModule("Create a CircleCI pipeline for this app", "/project");
    expect(result).toBe("circleci");
  });

  it("detects installed module with hyphenated name via spaces", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/circle-ci.dops", location: "project" },
    ]);

    const result = autoDetectInstalledModule(
      "Create a circle ci pipeline for this app",
      "/project",
    );
    expect(result).toBe("circle-ci");
  });

  it("skips modules already in MODULE_KEYWORDS", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/terraform.dops", location: "project" },
      { filePath: "/project/.dojops/tools/haproxy.dops", location: "project" },
    ]);

    // "terraform" is in MODULE_KEYWORDS, so autoDetectInstalledModule should skip it
    // and not match because "terraform" is the only match in the prompt
    const result = autoDetectInstalledModule("Create a Terraform config", "/project");
    expect(result).toBeUndefined();
  });

  it("returns installed module when built-in module does not match", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/haproxy.dops", location: "project" },
      { filePath: "/project/.dojops/tools/podman.dops", location: "project" },
    ]);

    const result = autoDetectInstalledModule(
      "Create an HAProxy config for load balancing",
      "/project",
    );
    expect(result).toBe("haproxy");
  });

  it("returns undefined when no installed modules exist", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([]);

    const result = autoDetectInstalledModule("Create a CircleCI pipeline", "/project");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no module name matches the prompt", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/haproxy.dops", location: "project" },
    ]);

    const result = autoDetectInstalledModule("Create a load balancer config", "/project");
    expect(result).toBeUndefined();
  });

  it("is case-insensitive for module name matching", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/traefik.dops", location: "project" },
    ]);

    const result = autoDetectInstalledModule("Create a TRAEFIK reverse proxy", "/project");
    expect(result).toBe("traefik");
  });

  it("passes projectRoot to discoverUserDopsFiles", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([]);

    autoDetectInstalledModule("some prompt", "/my/project");
    expect(mockDiscoverUserDopsFiles).toHaveBeenCalledWith("/my/project");
  });

  it("handles undefined projectRoot (global modules only)", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/home/user/.dojops/tools/caddy.dops", location: "global" },
    ]);

    const result = autoDetectInstalledModule("Create a Caddy reverse proxy", undefined);
    expect(result).toBe("caddy");
    expect(mockDiscoverUserDopsFiles).toHaveBeenCalledWith(undefined);
  });
});
