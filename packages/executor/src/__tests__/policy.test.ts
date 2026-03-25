import { describe, it, expect } from "vitest";
import {
  checkWriteAllowed,
  checkFileSize,
  filterEnvVars,
  PolicyViolationError,
  DEFAULT_POLICY,
  DEVOPS_WRITE_ALLOWLIST,
  isDevOpsFile,
  matchesAllowlistPattern,
} from "../policy";
import { ExecutionPolicy } from "../types";

describe("checkWriteAllowed", () => {
  it("throws when allowWrite is false", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, allowWrite: false };
    expect(() => checkWriteAllowed("/tmp/file.txt", policy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed("/tmp/file.txt", policy)).toThrow("not allowed by policy");
  });

  it("allows write when allowWrite is true and allowlist disabled", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      enforceDevOpsAllowlist: false,
    };
    expect(() => checkWriteAllowed("/tmp/file.txt", policy)).not.toThrow();
  });

  it("denies write to denied paths", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      deniedWritePaths: ["/etc"],
    };
    expect(() => checkWriteAllowed("/etc/passwd", policy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed("/etc/passwd", policy)).toThrow("denied by policy");
  });

  it("allows write only to allowed paths when specified", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      allowedWritePaths: ["/tmp/project"],
    };
    expect(() => checkWriteAllowed("/tmp/project/file.txt", policy)).not.toThrow();
    expect(() => checkWriteAllowed("/home/user/file.txt", policy)).toThrow(PolicyViolationError);
  });

  it("denied paths take priority over allowed paths", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      allowedWritePaths: ["/tmp"],
      deniedWritePaths: ["/tmp/secret"],
    };
    expect(() => checkWriteAllowed("/tmp/ok.txt", policy)).not.toThrow();
    expect(() => checkWriteAllowed("/tmp/secret/key", policy)).toThrow(PolicyViolationError);
  });

  it("blocks credential paths regardless of policy", () => {
    const permissive: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      allowedWritePaths: ["/"],
    };
    expect(() => checkWriteAllowed("/home/user/.ssh/id_rsa", permissive)).toThrow(
      "credential/system path",
    );
    expect(() => checkWriteAllowed("/home/user/.aws/credentials", permissive)).toThrow(
      "credential/system path",
    );
    expect(() => checkWriteAllowed("/home/user/.gnupg/private-keys-v1.d/key", permissive)).toThrow(
      "credential/system path",
    );
    expect(() => checkWriteAllowed("/home/user/.kube/config", permissive)).toThrow(
      "credential/system path",
    );
  });
});

describe("checkFileSize", () => {
  it("allows files within limit", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, maxFileSizeBytes: 1024 };
    expect(() => checkFileSize(500, policy)).not.toThrow();
  });

  it("rejects files exceeding limit", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, maxFileSizeBytes: 1024 };
    expect(() => checkFileSize(2048, policy)).toThrow(PolicyViolationError);
    expect(() => checkFileSize(2048, policy)).toThrow("exceeds limit");
  });
});

describe("filterEnvVars", () => {
  it("returns empty object when no env vars allowed", () => {
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, allowEnvVars: [] };
    const result = filterEnvVars(policy);
    expect(result).toEqual({});
  });

  it("filters to only allowed env vars", () => {
    process.env.DOJOPS_TEST_VAR = "test_value";
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowEnvVars: ["DOJOPS_TEST_VAR", "NONEXISTENT"],
    };
    const result = filterEnvVars(policy);
    expect(result).toEqual({ DOJOPS_TEST_VAR: "test_value" });
    delete process.env.DOJOPS_TEST_VAR;
  });
});

describe("DEVOPS_WRITE_ALLOWLIST", () => {
  it("contains expected DevOps patterns", () => {
    expect(DEVOPS_WRITE_ALLOWLIST).toContain(".github/workflows/**");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.tf");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("Dockerfile");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("Makefile");
  });

  it("contains script file patterns", () => {
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.sh");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.bash");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.zsh");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.py");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.ps1");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.psm1");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.bat");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("*.cmd");
    expect(DEVOPS_WRITE_ALLOWLIST).toContain("scripts/**");
  });
});

describe("matchesAllowlistPattern", () => {
  it("matches recursive directory patterns", () => {
    expect(matchesAllowlistPattern(".github/workflows/ci.yml", ".github/workflows/**")).toBe(true);
    expect(matchesAllowlistPattern("helm/values.yaml", "helm/**")).toBe(true);
    expect(matchesAllowlistPattern("src/index.ts", ".github/workflows/**")).toBe(false);
  });

  it("matches wildcard filename patterns", () => {
    expect(matchesAllowlistPattern("main.tf", "*.tf")).toBe(true);
    expect(matchesAllowlistPattern("vars.tfvars", "*.tfvars")).toBe(true);
    expect(matchesAllowlistPattern("Dockerfile.prod", "Dockerfile.*")).toBe(true);
    expect(matchesAllowlistPattern("docker-compose.prod.yml", "docker-compose*.yml")).toBe(true);
    expect(matchesAllowlistPattern("src/main.ts", "*.tf")).toBe(false);
  });

  it("matches exact filenames", () => {
    expect(matchesAllowlistPattern("Makefile", "Makefile")).toBe(true);
    expect(matchesAllowlistPattern("nginx.conf", "nginx.conf")).toBe(true);
    expect(matchesAllowlistPattern(".gitlab-ci.yml", ".gitlab-ci.yml")).toBe(true);
    expect(matchesAllowlistPattern("package.json", "Makefile")).toBe(false);
  });
});

describe("isDevOpsFile", () => {
  it("recognizes DevOps files", () => {
    expect(isDevOpsFile(".github/workflows/ci.yml")).toBe(true);
    expect(isDevOpsFile("main.tf")).toBe(true);
    expect(isDevOpsFile("Dockerfile")).toBe(true);
    expect(isDevOpsFile("Dockerfile.prod")).toBe(true);
    expect(isDevOpsFile("docker-compose.yml")).toBe(true);
    expect(isDevOpsFile("docker-compose.prod.yaml")).toBe(true);
    expect(isDevOpsFile("helm/Chart.yaml")).toBe(true);
    expect(isDevOpsFile("k8s/deployment.yaml")).toBe(true);
    expect(isDevOpsFile("ansible/playbook.yml")).toBe(true);
    expect(isDevOpsFile("playbook.yml")).toBe(true);
    expect(isDevOpsFile("nginx.conf")).toBe(true);
    expect(isDevOpsFile("Makefile")).toBe(true);
    expect(isDevOpsFile("app.service")).toBe(true);
    expect(isDevOpsFile(".gitlab-ci.yml")).toBe(true);
    expect(isDevOpsFile("prometheus/rules.yml")).toBe(true);
    expect(isDevOpsFile("prometheus.yml")).toBe(true);
    expect(isDevOpsFile("prometheus.yaml")).toBe(true);
    expect(isDevOpsFile("alertmanager.yml")).toBe(true);
    expect(isDevOpsFile("alertmanager.yaml")).toBe(true);
    expect(isDevOpsFile("packer/main.pkr.hcl")).toBe(true);
    expect(isDevOpsFile("main.pkr.hcl")).toBe(true);
    expect(isDevOpsFile("packer/variables.pkr.json")).toBe(true);
  });

  it("recognizes script files", () => {
    expect(isDevOpsFile("backup.sh")).toBe(true);
    expect(isDevOpsFile("deploy.bash")).toBe(true);
    expect(isDevOpsFile("init.zsh")).toBe(true);
    expect(isDevOpsFile("migrate.py")).toBe(true);
    expect(isDevOpsFile("setup.ps1")).toBe(true);
    expect(isDevOpsFile("utils.psm1")).toBe(true);
    expect(isDevOpsFile("build.bat")).toBe(true);
    expect(isDevOpsFile("run.cmd")).toBe(true);
    expect(isDevOpsFile("scripts/deploy.sh")).toBe(true);
    expect(isDevOpsFile("scripts/nested/test.py")).toBe(true);
  });

  it("rejects non-DevOps files", () => {
    expect(isDevOpsFile("src/index.ts")).toBe(false);
    expect(isDevOpsFile("package.json")).toBe(false);
    expect(isDevOpsFile("README.md")).toBe(false);
    expect(isDevOpsFile("tsconfig.json")).toBe(false);
    expect(isDevOpsFile(".env")).toBe(false);
  });
});

describe("checkWriteAllowed with DevOps allowlist", () => {
  it("allows DevOps files when allowlist is enforced", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      enforceDevOpsAllowlist: true,
    };
    expect(() => checkWriteAllowed("main.tf", policy)).not.toThrow();
    expect(() => checkWriteAllowed("Dockerfile", policy)).not.toThrow();
    expect(() => checkWriteAllowed(".github/workflows/ci.yml", policy)).not.toThrow();
  });

  it("blocks non-DevOps files when allowlist is enforced", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      enforceDevOpsAllowlist: true,
    };
    expect(() => checkWriteAllowed("src/index.ts", policy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed("package.json", policy)).toThrow(PolicyViolationError);
    expect(() => checkWriteAllowed("README.md", policy)).toThrow(PolicyViolationError);
  });

  it("does not enforce allowlist when disabled", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      enforceDevOpsAllowlist: false,
    };
    expect(() => checkWriteAllowed("src/index.ts", policy)).not.toThrow();
    expect(() => checkWriteAllowed("package.json", policy)).not.toThrow();
  });

  it("explicit allowedWritePaths takes precedence over DevOps allowlist", () => {
    const policy: ExecutionPolicy = {
      ...DEFAULT_POLICY,
      allowWrite: true,
      enforceDevOpsAllowlist: true,
      allowedWritePaths: ["/tmp/project"],
    };
    // Allowed by explicit path even though not a DevOps file
    expect(() => checkWriteAllowed("/tmp/project/src/index.ts", policy)).not.toThrow();
    // Blocked because not in allowed paths, even though it IS a DevOps file
    expect(() => checkWriteAllowed("/other/main.tf", policy)).toThrow(PolicyViolationError);
  });
});
