import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseDopsFileAny, validateDopsModuleAny } from "../parser";
import { isV2Module, type DopsModuleV2 } from "../spec";

const MODULES_DIR = path.join(__dirname, "../../modules");

function parseV2Module(filename: string): DopsModuleV2 {
  const mod = parseDopsFileAny(path.join(MODULES_DIR, filename));
  if (!isV2Module(mod)) throw new Error(`Expected v2 module: ${filename}`);
  return mod;
}

describe("Built-in .dops modules", () => {
  const moduleFiles = fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith(".dops"));

  it("discovers at least 3 built-in modules", () => {
    expect(moduleFiles.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of moduleFiles) {
    const moduleName = file.replace(".dops", "");

    describe(moduleName, () => {
      it("parses without errors", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module).toBeDefined();
        expect(module.frontmatter.dops).toBe("v2");
        expect(module.frontmatter.meta.name).toBe(moduleName);
      });

      it("validates successfully", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        const result = validateDopsModuleAny(module);
        expect(result.valid).toBe(true);
      });

      it("has required meta fields", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.frontmatter.meta.name).toBeTruthy();
        expect(module.frontmatter.meta.version).toBeTruthy();
        expect(module.frontmatter.meta.description).toBeTruthy();
      });

      it("has context block with required fields", () => {
        const module = parseV2Module(file);
        expect(module.frontmatter.context).toBeDefined();
        expect(module.frontmatter.context.technology).toBeTruthy();
        expect(module.frontmatter.context.fileFormat).toBeTruthy();
        expect(module.frontmatter.context.outputGuidance).toBeTruthy();
        expect(module.frontmatter.context.bestPractices.length).toBeGreaterThanOrEqual(1);
      });

      it("has at least one file spec", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.frontmatter.files.length).toBeGreaterThanOrEqual(1);
      });

      it("has ## Prompt section", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.sections.prompt).toBeTruthy();
      });

      it("has ## Keywords section", () => {
        const module = parseDopsFileAny(path.join(MODULES_DIR, file));
        expect(module.sections.keywords).toBeTruthy();
      });
    });
  }
});

describe("terraform.dops", () => {
  it("has context with Terraform technology and HCL format", () => {
    const module = parseV2Module("terraform.dops");
    expect(module.frontmatter.context.technology).toBe("Terraform");
    expect(module.frontmatter.context.fileFormat).toBe("hcl");
  });

  it("has context7Libraries referencing terraform", () => {
    const module = parseV2Module("terraform.dops");
    const libs = module.frontmatter.context.context7Libraries ?? [];
    expect(libs.some((l) => l.name === "terraform")).toBe(true);
  });

  it("has binary verification with terraform-json parser", () => {
    const module = parseV2Module("terraform.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("terraform-json");
  });

  it("generates raw .tf files", () => {
    const module = parseV2Module("terraform.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toContain(".tf");
  });
});

describe("github-actions.dops", () => {
  it("has context with GitHub Actions technology and YAML format", () => {
    const module = parseV2Module("github-actions.dops");
    expect(module.frontmatter.context.technology).toBe("GitHub Actions");
    expect(module.frontmatter.context.fileFormat).toBe("yaml");
  });

  it("has structural verification for on/jobs", () => {
    const module = parseV2Module("github-actions.dops");
    const rules = module.frontmatter.verification?.structural ?? [];
    expect(rules.some((r) => r.path === "on")).toBe(true);
    expect(rules.some((r) => r.path === "jobs")).toBe(true);
  });

  it("has context7Libraries referencing github-actions", () => {
    const module = parseV2Module("github-actions.dops");
    const libs = module.frontmatter.context.context7Libraries ?? [];
    expect(libs.some((l) => l.name === "github-actions")).toBe(true);
  });
});

describe("kubernetes.dops", () => {
  it("has context with Kubernetes technology and YAML format", () => {
    const module = parseV2Module("kubernetes.dops");
    expect(module.frontmatter.context.technology).toBe("Kubernetes");
    expect(module.frontmatter.context.fileFormat).toBe("yaml");
  });

  it("has binary verification with kubectl", () => {
    const module = parseV2Module("kubernetes.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("kubectl-stderr");
  });

  it("has structural verification for kind and apiVersion", () => {
    const module = parseV2Module("kubernetes.dops");
    const rules = module.frontmatter.verification?.structural ?? [];
    expect(rules.some((r) => r.path === "kind")).toBe(true);
    expect(rules.some((r) => r.path === "apiVersion")).toBe(true);
  });
});

describe("helm.dops", () => {
  it("has context with Helm technology and JSON format (multi-file wrapper)", () => {
    const module = parseV2Module("helm.dops");
    expect(module.frontmatter.context.technology).toBe("Helm");
    expect(module.frontmatter.context.fileFormat).toBe("json");
  });

  it("has multiple file specs including templates", () => {
    const module = parseV2Module("helm.dops");
    expect(module.frontmatter.files.length).toBeGreaterThanOrEqual(5);
    const templateFiles = module.frontmatter.files.filter((f) => f.path.includes("templates/"));
    expect(templateFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("has binary verification with helm lint", () => {
    const module = parseV2Module("helm.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("helm-lint");
  });

  it("has context7Libraries referencing helm", () => {
    const module = parseV2Module("helm.dops");
    const libs = module.frontmatter.context.context7Libraries ?? [];
    expect(libs.some((l) => l.name === "helm")).toBe(true);
  });
});

describe("ansible.dops", () => {
  it("has context with Ansible technology and raw format", () => {
    const module = parseV2Module("ansible.dops");
    expect(module.frontmatter.context.technology).toBe("Ansible");
    expect(module.frontmatter.context.fileFormat).toBe("raw");
  });

  it("has binary verification with ansible-playbook", () => {
    const module = parseV2Module("ansible.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("ansible-syntax");
  });

  it("generates raw playbook file", () => {
    const module = parseV2Module("ansible.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
  });
});

describe("docker-compose.dops", () => {
  it("has context with Docker Compose technology and YAML format", () => {
    const module = parseV2Module("docker-compose.dops");
    expect(module.frontmatter.context.technology).toBe("Docker Compose");
    expect(module.frontmatter.context.fileFormat).toBe("yaml");
  });

  it("has structural verification for services", () => {
    const module = parseV2Module("docker-compose.dops");
    const rules = module.frontmatter.verification?.structural ?? [];
    expect(rules.some((r) => r.path === "services")).toBe(true);
  });

  it("has binary verification with docker compose", () => {
    const module = parseV2Module("docker-compose.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("docker-compose-config");
  });

  it("detects multiple compose file names", () => {
    const module = parseV2Module("docker-compose.dops");
    const paths = module.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("docker-compose.yml");
    expect(paths).toContain("compose.yml");
  });
});

describe("dockerfile.dops", () => {
  it("has context with Docker technology and raw format", () => {
    const module = parseV2Module("dockerfile.dops");
    expect(module.frontmatter.context.technology).toBe("Docker");
    expect(module.frontmatter.context.fileFormat).toBe("raw");
  });

  it("generates raw Dockerfile", () => {
    const module = parseV2Module("dockerfile.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toBe("Dockerfile");
  });

  it("has binary verification with hadolint", () => {
    const module = parseV2Module("dockerfile.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("hadolint-json");
  });
});

describe("nginx.dops", () => {
  it("has context with Nginx technology and raw format", () => {
    const module = parseV2Module("nginx.dops");
    expect(module.frontmatter.context.technology).toBe("Nginx");
    expect(module.frontmatter.context.fileFormat).toBe("raw");
  });

  it("generates raw nginx.conf", () => {
    const module = parseV2Module("nginx.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toContain("nginx.conf");
  });

  it("has binary verification with nginx", () => {
    const module = parseV2Module("nginx.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("nginx-stderr");
  });
});

describe("makefile.dops", () => {
  it("has context with GNU Make technology and raw format", () => {
    const module = parseV2Module("makefile.dops");
    expect(module.frontmatter.context.technology).toBe("GNU Make");
    expect(module.frontmatter.context.fileFormat).toBe("raw");
  });

  it("generates raw Makefile", () => {
    const module = parseV2Module("makefile.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toBe("Makefile");
  });

  it("has binary verification with make", () => {
    const module = parseV2Module("makefile.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("make-dryrun");
  });

  it("detects multiple Makefile names", () => {
    const module = parseV2Module("makefile.dops");
    const paths = module.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("Makefile");
    expect(paths).toContain("makefile");
    expect(paths).toContain("GNUmakefile");
  });
});

describe("gitlab-ci.dops", () => {
  it("has context with GitLab CI technology and YAML format", () => {
    const module = parseV2Module("gitlab-ci.dops");
    expect(module.frontmatter.context.technology).toBe("GitLab CI");
    expect(module.frontmatter.context.fileFormat).toBe("yaml");
  });

  it("has structural verification for stages", () => {
    const module = parseV2Module("gitlab-ci.dops");
    const rules = module.frontmatter.verification?.structural ?? [];
    expect(rules.some((r) => r.path === "stages")).toBe(true);
  });

  it("has binary verification via yamllint", () => {
    const module = parseV2Module("gitlab-ci.dops");
    expect(module.frontmatter.verification?.binary).toBeDefined();
    expect(module.frontmatter.verification?.binary?.command).toContain("yamllint");
    expect(module.frontmatter.verification?.binary?.parser).toBe("generic-stderr");
    expect(module.frontmatter.permissions?.child_process).toBe("required");
  });
});

describe("prometheus.dops", () => {
  it("has context with Prometheus technology and JSON format (multi-file wrapper)", () => {
    const module = parseV2Module("prometheus.dops");
    expect(module.frontmatter.context.technology).toBe("Prometheus");
    expect(module.frontmatter.context.fileFormat).toBe("json");
  });

  it("has three file specs", () => {
    const module = parseV2Module("prometheus.dops");
    expect(module.frontmatter.files.length).toBe(3);
  });

  it("has conditional alert-rules and alertmanager files", () => {
    const module = parseV2Module("prometheus.dops");
    const conditionalFiles = module.frontmatter.files.filter((f) => f.conditional === true);
    expect(conditionalFiles.length).toBe(2);
  });

  it("has binary verification with promtool", () => {
    const module = parseV2Module("prometheus.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("promtool");
  });
});

describe("systemd.dops", () => {
  it("has context with systemd technology and raw format", () => {
    const module = parseV2Module("systemd.dops");
    expect(module.frontmatter.context.technology).toBe("systemd");
    expect(module.frontmatter.context.fileFormat).toBe("raw");
  });

  it("generates raw .service file", () => {
    const module = parseV2Module("systemd.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toContain(".service");
  });

  it("has binary verification with systemd-analyze", () => {
    const module = parseV2Module("systemd.dops");
    expect(module.frontmatter.verification?.binary?.parser).toBe("systemd-analyze");
  });
});
