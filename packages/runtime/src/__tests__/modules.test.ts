import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseDopsFile, validateDopsModule } from "../parser";

const MODULES_DIR = path.join(__dirname, "../../modules");

describe("Built-in .dops modules", () => {
  const moduleFiles = fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith(".dops"));

  it("discovers at least 3 built-in modules", () => {
    expect(moduleFiles.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of moduleFiles) {
    const moduleName = file.replace(".dops", "");

    describe(moduleName, () => {
      it("parses without errors", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        expect(module).toBeDefined();
        expect(module.frontmatter.dops).toBe("v1");
        expect(module.frontmatter.meta.name).toBe(moduleName);
      });

      it("validates successfully", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        const result = validateDopsModule(module);
        expect(result.valid).toBe(true);
      });

      it("has required meta fields", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        expect(module.frontmatter.meta.name).toBeTruthy();
        expect(module.frontmatter.meta.version).toBeTruthy();
        expect(module.frontmatter.meta.description).toBeTruthy();
      });

      it("has output schema", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        expect(module.frontmatter.output).toBeDefined();
      });

      it("has at least one file spec", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        expect(module.frontmatter.files.length).toBeGreaterThanOrEqual(1);
      });

      it("has ## Prompt section", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        expect(module.sections.prompt).toBeTruthy();
      });

      it("has ## Keywords section", () => {
        const module = parseDopsFile(path.join(MODULES_DIR, file));
        expect(module.sections.keywords).toBeTruthy();
      });
    });
  }
});

describe("terraform.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "terraform.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["projectPath"]).toBeDefined();
    expect(fields["provider"]).toBeDefined();
    expect(fields["resources"]).toBeDefined();
    expect(fields["backendType"]).toBeDefined();
  });

  it("has structural verification rules", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "terraform.dops"));
    expect(module.frontmatter.verification?.structural?.length).toBeGreaterThan(0);
  });

  it("has binary verification", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "terraform.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("terraform-json");
  });

  it("uses HCL format with mapAttributes", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "terraform.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("hcl");
    expect(file.options?.mapAttributes).toContain("tags");
  });
});

describe("github-actions.dops", () => {
  it("has YAML format with key ordering", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "github-actions.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("yaml");
    expect(file.options?.keyOrder).toContain("name");
    expect(file.options?.keyOrder).toContain("on");
    expect(file.options?.keyOrder).toContain("jobs");
  });

  it("has structural verification for on/jobs", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "github-actions.dops"));
    const rules = module.frontmatter.verification?.structural ?? [];
    expect(rules.some((r) => r.path === "on")).toBe(true);
    expect(rules.some((r) => r.path === "jobs")).toBe(true);
  });
});

describe("kubernetes.dops", () => {
  it("uses multi-document YAML", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "kubernetes.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("yaml");
    expect(file.multiDocument).toBe(true);
  });

  it("has binary verification with kubectl", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "kubernetes.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("kubectl-stderr");
  });
});

describe("helm.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "helm.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["chartName"]).toBeDefined();
    expect(fields["image"]).toBeDefined();
    expect(fields["port"]).toBeDefined();
    expect(fields["outputPath"]).toBeDefined();
  });

  it("has multiple file specs including templates", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "helm.dops"));
    expect(module.frontmatter.files.length).toBeGreaterThanOrEqual(5);
    const templateFiles = module.frontmatter.files.filter((f) => f.source === "template");
    expect(templateFiles.length).toBeGreaterThanOrEqual(3);
  });

  it("uses dataPath for values.yaml", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "helm.dops"));
    const valuesFile = module.frontmatter.files.find((f) => f.path.includes("values.yaml"));
    expect(valuesFile).toBeDefined();
    expect(valuesFile!.dataPath).toBe("values");
    expect(valuesFile!.format).toBe("yaml");
  });

  it("has binary verification with helm lint", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "helm.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("helm-lint");
  });
});

describe("ansible.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "ansible.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["playbookName"]).toBeDefined();
    expect(fields["targetOS"]).toBeDefined();
    expect(fields["tasks"]).toBeDefined();
  });

  it("uses raw format with dataPath for content", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "ansible.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.dataPath).toBe("content");
  });

  it("has binary verification with ansible-playbook", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "ansible.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("ansible-syntax");
  });
});

describe("docker-compose.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "docker-compose.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["projectPath"]).toBeDefined();
    expect(fields["services"]).toBeDefined();
    expect(fields["networkMode"]).toBeDefined();
  });

  it("uses YAML format", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "docker-compose.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("yaml");
  });

  it("has binary verification with docker compose", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "docker-compose.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("docker-compose-config");
  });

  it("detects multiple compose file names", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "docker-compose.dops"));
    const paths = module.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("docker-compose.yml");
    expect(paths).toContain("compose.yml");
  });
});

describe("dockerfile.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "dockerfile.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["baseImage"]).toBeDefined();
    expect(fields["outputPath"]).toBeDefined();
  });

  it("has two file specs with dataPath", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "dockerfile.dops"));
    expect(module.frontmatter.files.length).toBe(2);
    expect(module.frontmatter.files[0].dataPath).toBe("content");
    expect(module.frontmatter.files[1].dataPath).toBe("dockerignoreContent");
  });

  it("has conditional .dockerignore file", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "dockerfile.dops"));
    const dockerignoreFile = module.frontmatter.files.find((f) => f.path.includes(".dockerignore"));
    expect(dockerignoreFile).toBeDefined();
    expect(dockerignoreFile!.conditional).toBe(true);
  });

  it("has binary verification with hadolint", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "dockerfile.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("hadolint-json");
  });
});

describe("nginx.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "nginx.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["serverName"]).toBeDefined();
    expect(fields["sslEnabled"]).toBeDefined();
  });

  it("uses raw format with dataPath for content", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "nginx.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.dataPath).toBe("content");
  });

  it("has binary verification with nginx", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "nginx.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("nginx-stderr");
  });
});

describe("makefile.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "makefile.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["projectPath"]).toBeDefined();
    expect(fields["targets"]).toBeDefined();
  });

  it("uses raw format with dataPath for content", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "makefile.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.dataPath).toBe("content");
  });

  it("has binary verification with make", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "makefile.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("make-dryrun");
  });

  it("detects multiple Makefile names", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "makefile.dops"));
    const paths = module.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("Makefile");
    expect(paths).toContain("makefile");
    expect(paths).toContain("GNUmakefile");
  });
});

describe("gitlab-ci.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "gitlab-ci.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["projectPath"]).toBeDefined();
    expect(fields["defaultBranch"]).toBeDefined();
  });

  it("uses YAML format without key sorting", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "gitlab-ci.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("yaml");
    expect(file.options?.sortKeys).toBe(false);
  });

  it("has structural verification for stages", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "gitlab-ci.dops"));
    const rules = module.frontmatter.verification?.structural ?? [];
    expect(rules.some((r) => r.path === "stages")).toBe(true);
  });

  it("has no binary verification (structural only)", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "gitlab-ci.dops"));
    expect(module.frontmatter.verification?.binary).toBeUndefined();
    expect(module.frontmatter.permissions?.child_process).toBe("none");
  });
});

describe("prometheus.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "prometheus.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["targets"]).toBeDefined();
    expect(fields["scrapeInterval"]).toBeDefined();
    expect(fields["outputPath"]).toBeDefined();
  });

  it("has three file specs with dataPath", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "prometheus.dops"));
    expect(module.frontmatter.files.length).toBe(3);
    expect(module.frontmatter.files[0].dataPath).toBe("prometheusYaml");
    expect(module.frontmatter.files[1].dataPath).toBe("alertRulesYaml");
    expect(module.frontmatter.files[2].dataPath).toBe("alertmanagerYaml");
  });

  it("has conditional alert-rules and alertmanager files", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "prometheus.dops"));
    expect(module.frontmatter.files[1].conditional).toBe(true);
    expect(module.frontmatter.files[2].conditional).toBe(true);
    expect(module.frontmatter.files[0].conditional).toBeUndefined();
  });

  it("has binary verification with promtool", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "prometheus.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("promtool");
  });
});

describe("systemd.dops", () => {
  it("has correct input fields", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "systemd.dops"));
    const fields = module.frontmatter.input!.fields;
    expect(fields["serviceName"]).toBeDefined();
    expect(fields["execStart"]).toBeDefined();
    expect(fields["user"]).toBeDefined();
  });

  it("uses raw format with dataPath for content", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "systemd.dops"));
    const file = module.frontmatter.files[0];
    expect(file.format).toBe("raw");
    expect(file.dataPath).toBe("content");
  });

  it("has dynamic file path with serviceName", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "systemd.dops"));
    const file = module.frontmatter.files[0];
    expect(file.path).toContain("{serviceName}");
    expect(file.path).toContain(".service");
  });

  it("has binary verification with systemd-analyze", () => {
    const module = parseDopsFile(path.join(MODULES_DIR, "systemd.dops"));
    expect(module.frontmatter.verification?.binary?.parser).toBe("systemd-analyze");
  });
});
