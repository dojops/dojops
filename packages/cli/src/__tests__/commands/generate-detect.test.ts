import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discoverUserDopsFiles from @dojops/skill-registry
const mockDiscoverUserDopsFiles = vi.fn();
vi.mock("@dojops/skill-registry", () => ({
  createSkillRegistry: vi.fn(),
  discoverUserDopsFiles: (...args: unknown[]) => mockDiscoverUserDopsFiles(...args),
}));

import { autoDetectSkill, autoDetectInstalledSkill } from "../../commands/generate";

describe("autoDetectSkill", () => {
  it("detects github-actions from prompt", () => {
    expect(autoDetectSkill("Create a GitHub Actions workflow")).toBe("github-actions");
  });

  it("detects terraform from prompt", () => {
    expect(autoDetectSkill("Create Terraform config for AWS")).toBe("terraform");
  });

  it("detects kubernetes from prompt", () => {
    expect(autoDetectSkill("Create k8s deployment")).toBe("kubernetes");
  });

  it("detects jenkinsfile from prompt", () => {
    expect(autoDetectSkill("Create a Jenkinsfile pipeline")).toBe("jenkinsfile");
  });

  it("returns undefined for unrecognized prompts", () => {
    expect(autoDetectSkill("How do I deploy my app?")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(autoDetectSkill("Create a DOCKERFILE")).toBe("dockerfile");
  });

  it("skips module detection for analysis questions", () => {
    expect(
      autoDetectSkill("What do you think about our current github workflows?"),
    ).toBeUndefined();
    expect(autoDetectSkill("Analyse our terraform configuration")).toBeUndefined();
    expect(autoDetectSkill("Review the kubernetes deployment")).toBeUndefined();
    expect(autoDetectSkill("Is our dockerfile following best practices?")).toBeUndefined();
    expect(autoDetectSkill("Check the ansible playbook for issues")).toBeUndefined();
    expect(autoDetectSkill("Tell me about the nginx config")).toBeUndefined();
  });

  it("still detects modules for generation prompts with action verbs", () => {
    expect(autoDetectSkill("Create a GitHub Actions workflow")).toBe("github-actions");
    expect(autoDetectSkill("Generate terraform config for S3")).toBe("terraform");
    expect(autoDetectSkill("Write a kubernetes deployment manifest")).toBe("kubernetes");
    expect(autoDetectSkill("Set up a dockerfile for Node.js")).toBe("dockerfile");
  });
});

describe("autoDetectInstalledSkill", () => {
  beforeEach(() => {
    mockDiscoverUserDopsFiles.mockReset();
  });

  it("detects installed module by name match", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/drone.dops", location: "project" },
    ]);

    const result = autoDetectInstalledSkill("Create a Drone pipeline for this app", "/project");
    expect(result).toBe("drone");
  });

  it("detects installed module with hyphenated name via spaces", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/circle-ci.dops", location: "project" },
    ]);

    const result = autoDetectInstalledSkill("Create a circle ci pipeline for this app", "/project");
    expect(result).toBe("circle-ci");
  });

  it("skips modules already in SKILL_KEYWORDS", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/terraform.dops", location: "project" },
      { filePath: "/project/.dojops/tools/haproxy.dops", location: "project" },
    ]);

    // "terraform" is in SKILL_KEYWORDS, so autoDetectInstalledSkill should skip it
    // and not match because "terraform" is the only match in the prompt
    const result = autoDetectInstalledSkill("Create a Terraform config", "/project");
    expect(result).toBeUndefined();
  });

  it("returns installed module when built-in module does not match", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/haproxy.dops", location: "project" },
      { filePath: "/project/.dojops/tools/podman.dops", location: "project" },
    ]);

    const result = autoDetectInstalledSkill(
      "Create an HAProxy config for load balancing",
      "/project",
    );
    expect(result).toBe("haproxy");
  });

  it("returns undefined when no installed modules exist", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([]);

    const result = autoDetectInstalledSkill("Create a CircleCI pipeline", "/project");
    expect(result).toBeUndefined();
  });

  it("returns undefined when no module name matches the prompt", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/haproxy.dops", location: "project" },
    ]);

    const result = autoDetectInstalledSkill("Create a load balancer config", "/project");
    expect(result).toBeUndefined();
  });

  it("is case-insensitive for module name matching", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/project/.dojops/tools/traefik.dops", location: "project" },
    ]);

    const result = autoDetectInstalledSkill("Create a TRAEFIK reverse proxy", "/project");
    expect(result).toBe("traefik");
  });

  it("passes projectRoot to discoverUserDopsFiles", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([]);

    autoDetectInstalledSkill("some prompt", "/my/project");
    expect(mockDiscoverUserDopsFiles).toHaveBeenCalledWith("/my/project");
  });

  it("handles undefined projectRoot (global modules only)", () => {
    mockDiscoverUserDopsFiles.mockReturnValue([
      { filePath: "/home/user/.dojops/tools/caddy.dops", location: "global" },
    ]);

    const result = autoDetectInstalledSkill("Create a Caddy reverse proxy", undefined);
    expect(result).toBe("caddy");
    expect(mockDiscoverUserDopsFiles).toHaveBeenCalledWith(undefined);
  });
});
