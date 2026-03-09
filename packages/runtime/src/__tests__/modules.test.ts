import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDopsFileAny, validateDopsModuleAny } from "../parser";
import { isV2Module, type DopsModuleV2 } from "../spec";

const MODULES_DIR = path.join(__dirname, "../../modules");

function parseV2Module(filename: string): DopsModuleV2 {
  const mod = parseDopsFileAny(path.join(MODULES_DIR, filename));
  if (!isV2Module(mod)) throw new Error(`Expected v2 module: ${filename}`);
  return mod;
}

/** Assert a module's context technology and fileFormat. */
function expectContext(filename: string, technology: string, fileFormat: string): void {
  const module = parseV2Module(filename);
  expect(module.frontmatter.context.technology).toBe(technology);
  expect(module.frontmatter.context.fileFormat).toBe(fileFormat);
}

/** Assert a module's binary verification parser. */
function expectBinaryParser(filename: string, parser: string): void {
  const module = parseV2Module(filename);
  expect(module.frontmatter.verification?.binary?.parser).toBe(parser);
}

/** Assert a module has structural verification rules matching the given paths. */
function expectStructuralPaths(filename: string, paths: string[]): void {
  const module = parseV2Module(filename);
  const rules = module.frontmatter.verification?.structural ?? [];
  for (const p of paths) {
    expect(rules.some((r) => r.path === p)).toBe(true);
  }
}

/** Assert a module has context7Libraries referencing the given library name. */
function expectContext7Library(filename: string, libraryName: string): void {
  const module = parseV2Module(filename);
  const libs = module.frontmatter.context.context7Libraries ?? [];
  expect(libs.some((l) => l.name === libraryName)).toBe(true);
}

/** Assert the first file spec has the given format and optionally matches a path pattern. */
function expectFirstFile(filename: string, format: string, pathMatch?: string): void {
  const module = parseV2Module(filename);
  const file = module.frontmatter.files[0];
  expect(file.format).toBe(format);
  if (pathMatch !== undefined) {
    expect(file.path).toContain(pathMatch);
  }
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
  it("has context with Terraform technology and JSON format (multi-file)", () => {
    expectContext("terraform.dops", "Terraform", "json");
  });

  it("has context7Libraries referencing terraform", () => {
    expectContext7Library("terraform.dops", "terraform");
  });

  it("has binary verification with terraform-json parser", () => {
    expectBinaryParser("terraform.dops", "terraform-json");
  });

  it("generates raw .tf files", () => {
    expectFirstFile("terraform.dops", "raw", ".tf");
  });
});

describe("github-actions.dops", () => {
  it("has context with GitHub Actions technology and JSON format (multi-file wrapper)", () => {
    expectContext("github-actions.dops", "GitHub Actions", "json");
  });

  it("has binary verification with actionlint", () => {
    const module = parseDopsFileAny(path.join(MODULES_DIR, "github-actions.dops"));
    expect(module.frontmatter.verification?.binary?.command).toContain("actionlint");
  });

  it("has multiple file specs including actions and reusable workflows", () => {
    const module = parseDopsFileAny(path.join(MODULES_DIR, "github-actions.dops"));
    const paths = module.frontmatter.files.map((f: { path: string }) => f.path);
    expect(paths.length).toBeGreaterThanOrEqual(5);
    expect(paths.some((p: string) => p.includes(".github/workflows/"))).toBe(true);
    expect(paths.some((p: string) => p.includes(".github/actions/"))).toBe(true);
  });

  it("has context7Libraries referencing github-actions", () => {
    expectContext7Library("github-actions.dops", "github-actions");
  });
});

describe("kubernetes.dops", () => {
  it("has context with Kubernetes technology and YAML format", () => {
    expectContext("kubernetes.dops", "Kubernetes", "yaml");
  });

  it("has binary verification with kubectl", () => {
    expectBinaryParser("kubernetes.dops", "kubectl-stderr");
  });

  it("has structural verification for kind and apiVersion", () => {
    expectStructuralPaths("kubernetes.dops", ["kind", "apiVersion"]);
  });
});

describe("helm.dops", () => {
  it("has context with Helm technology and JSON format (multi-file wrapper)", () => {
    expectContext("helm.dops", "Helm", "json");
  });

  it("has multiple file specs including templates", () => {
    const module = parseV2Module("helm.dops");
    expect(module.frontmatter.files.length).toBeGreaterThanOrEqual(5);
    const templateFiles = module.frontmatter.files.filter((f) => f.path.includes("templates/"));
    expect(templateFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("has binary verification with helm lint", () => {
    expectBinaryParser("helm.dops", "helm-lint");
  });

  it("has context7Libraries referencing helm", () => {
    expectContext7Library("helm.dops", "helm");
  });
});

describe("ansible.dops", () => {
  it("has context with Ansible technology and JSON format (multi-file wrapper)", () => {
    expectContext("ansible.dops", "Ansible", "json");
  });

  it("has binary verification with ansible-playbook", () => {
    expectBinaryParser("ansible.dops", "ansible-syntax");
  });

  it("generates raw playbook file", () => {
    expectFirstFile("ansible.dops", "raw");
  });
});

describe("docker-compose.dops", () => {
  it("has context with Docker Compose technology and YAML format", () => {
    expectContext("docker-compose.dops", "Docker Compose", "yaml");
  });

  it("has structural verification for services", () => {
    expectStructuralPaths("docker-compose.dops", ["services"]);
  });

  it("has binary verification with docker compose", () => {
    expectBinaryParser("docker-compose.dops", "docker-compose-config");
  });

  it("detects multiple compose file names", () => {
    const module = parseV2Module("docker-compose.dops");
    const paths = module.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("docker-compose.yml");
    expect(paths).toContain("compose.yml");
  });
});

describe("dockerfile.dops", () => {
  it("has context with Docker technology and JSON format (multi-file wrapper)", () => {
    expectContext("dockerfile.dops", "Docker", "json");
  });

  it("generates raw Dockerfile", () => {
    const module = parseV2Module("dockerfile.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toBe("Dockerfile");
  });

  it("has binary verification with hadolint", () => {
    expectBinaryParser("dockerfile.dops", "hadolint-json");
  });
});

describe("nginx.dops", () => {
  it("has context with Nginx technology and raw format", () => {
    expectContext("nginx.dops", "Nginx", "raw");
  });

  it("generates raw nginx.conf", () => {
    expectFirstFile("nginx.dops", "raw", "nginx.conf");
  });

  it("has binary verification with nginx", () => {
    expectBinaryParser("nginx.dops", "nginx-stderr");
  });
});

describe("makefile.dops", () => {
  it("has context with GNU Make technology and raw format", () => {
    expectContext("makefile.dops", "GNU Make", "raw");
  });

  it("generates raw Makefile", () => {
    const module = parseV2Module("makefile.dops");
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.path).toBe("Makefile");
  });

  it("has binary verification with make", () => {
    expectBinaryParser("makefile.dops", "make-dryrun");
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
    expectContext("gitlab-ci.dops", "GitLab CI", "yaml");
  });

  it("has structural verification for stages", () => {
    expectStructuralPaths("gitlab-ci.dops", ["stages"]);
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
    expectContext("prometheus.dops", "Prometheus", "json");
  });

  it("has four file specs", () => {
    const module = parseV2Module("prometheus.dops");
    expect(module.frontmatter.files.length).toBe(4);
  });

  it("has conditional alert-rules, recording-rules, and alertmanager files", () => {
    const module = parseV2Module("prometheus.dops");
    const conditionalFiles = module.frontmatter.files.filter((f) => f.conditional === true);
    expect(conditionalFiles.length).toBe(3);
  });

  it("has binary verification with promtool", () => {
    expectBinaryParser("prometheus.dops", "promtool");
  });
});

describe("systemd.dops", () => {
  it("has context with systemd technology and raw format", () => {
    expectContext("systemd.dops", "systemd", "raw");
  });

  it("generates raw .service file", () => {
    expectFirstFile("systemd.dops", "raw", ".service");
  });

  it("has binary verification with systemd-analyze", () => {
    expectBinaryParser("systemd.dops", "systemd-analyze");
  });
});
