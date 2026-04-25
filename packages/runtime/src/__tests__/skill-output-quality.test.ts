import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseDopsFile } from "../parser";
import { stripCodeFences, parseMultiFileOutput } from "../runtime";
import { validateStructure } from "../structural-validator";

const SKILLS_DIR = path.join(__dirname, "../../skills");

// ── Detection path matching ──────────────────────────────────────────

describe("skill detection paths", () => {
  it("kubernetes.dops detects k8s-specific directories, not bare *.yaml", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "kubernetes.dops"));
    const paths = skill.frontmatter.detection?.paths ?? [];
    for (const p of paths) {
      expect(p).not.toBe("*.yaml");
      expect(p).not.toBe("*.yml");
    }
    const joined = paths.join(" ");
    expect(joined).toContain("k8s/");
    expect(joined).toContain("kubernetes/");
    expect(joined).toContain("manifests/");
    expect(joined).toContain("deploy/");
  });

  it("docker-compose.dops detects standard compose filenames", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "docker-compose.dops"));
    const paths = skill.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("docker-compose.yml");
    expect(paths).toContain("compose.yml");
  });

  it("makefile.dops detects all Makefile variants", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "makefile.dops"));
    const paths = skill.frontmatter.detection?.paths ?? [];
    expect(paths).toContain("Makefile");
    expect(paths).toContain("makefile");
    expect(paths).toContain("GNUmakefile");
  });

  it("github-actions.dops detects workflow directory", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "github-actions.dops"));
    const paths = skill.frontmatter.detection?.paths ?? [];
    expect(paths.some((p) => p.includes(".github/workflows"))).toBe(true);
  });

  it("gitlab-ci.dops detects .gitlab-ci.yml", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "gitlab-ci.dops"));
    const paths = skill.frontmatter.detection?.paths ?? [];
    expect(paths).toContain(".gitlab-ci.yml");
  });

  it("dockerfile.dops detects Dockerfile", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "dockerfile.dops"));
    const paths = skill.frontmatter.detection?.paths ?? [];
    expect(paths.some((p) => p.includes("Dockerfile"))).toBe(true);
  });

  it("all skills with detection have at least one path", () => {
    const skillFiles = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".dops"));
    for (const file of skillFiles) {
      const skill = parseDopsFile(path.join(SKILLS_DIR, file));
      if (skill.frontmatter.detection) {
        expect(skill.frontmatter.detection.paths.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ── stripCodeFences with realistic LLM output ───────────────────────

describe("stripCodeFences — Ollama-style preamble", () => {
  it("extracts JSON from Ollama response with preamble text", () => {
    const input = `Here's the Terraform configuration you requested:

\`\`\`json
{
  "files": {
    "main.tf": "resource \\"aws_s3_bucket\\" \\"main\\" {}"
  }
}
\`\`\`

This creates an S3 bucket with default settings.`;
    const result = stripCodeFences(input);
    expect(result).toContain('"files"');
    expect(result).not.toContain("Here's the");
    expect(result).not.toContain("This creates");
  });

  it("extracts HCL from response with explanation", () => {
    const input = `I'll create a Terraform configuration:

\`\`\`hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}
\`\`\``;
    const result = stripCodeFences(input);
    expect(result).toContain('resource "aws_vpc"');
    expect(result).not.toContain("I'll create");
  });

  it("extracts YAML from fenced block", () => {
    const input = `\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
\`\`\``;
    const result = stripCodeFences(input);
    expect(result).toContain("apiVersion: apps/v1");
    expect(result).not.toContain("```");
  });

  it("handles triple-tilde fences from some models", () => {
    const input = `~~~json
{"services": {"web": {"image": "nginx"}}}
~~~`;
    const result = stripCodeFences(input);
    expect(result).toContain('"services"');
    expect(result).not.toContain("~~~");
  });

  it("returns clean content when no fences present", () => {
    const input = 'resource "aws_s3_bucket" "main" {\n  bucket = "my-bucket"\n}';
    const result = stripCodeFences(input);
    expect(result).toBe(input);
  });

  it("extracts first block when LLM returns multiple", () => {
    const input = `\`\`\`yaml
apiVersion: v1
kind: Service
\`\`\`

And here's the deployment:

\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
\`\`\``;
    const result = stripCodeFences(input);
    expect(result).toContain("Service");
    expect(result).not.toContain("Deployment");
  });
});

// ── parseMultiFileOutput with realistic skill outputs ────────────────

describe("parseMultiFileOutput — Dockerfile skill wrapper", () => {
  it("parses Dockerfile + .dockerignore wrapper", () => {
    const wrapper = JSON.stringify({
      files: {
        Dockerfile:
          'FROM node:20-slim AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:20-slim\nWORKDIR /app\nCOPY --from=builder /app/dist ./dist\nCOPY --from=builder /app/node_modules ./node_modules\nEXPOSE 3000\nCMD ["node", "dist/index.js"]',
        ".dockerignore": "node_modules\n.git\n.env\ndist\n*.log\nDockerfile\ndocker-compose*.yml",
      },
    });
    const result = parseMultiFileOutput(wrapper);
    expect(result["Dockerfile"]).toContain("FROM node:20-slim");
    expect(result["Dockerfile"]).toContain("builder");
    expect(result[".dockerignore"]).toContain("node_modules");
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("parseMultiFileOutput — Helm chart wrapper", () => {
  it("parses Chart.yaml + values.yaml + templates", () => {
    const wrapper = JSON.stringify({
      files: {
        "Chart.yaml": "apiVersion: v2\nname: myapp\nversion: 1.0.0\ntype: application",
        "values.yaml": "replicaCount: 2\nimage:\n  repository: myapp\n  tag: latest",
        "templates/deployment.yaml":
          "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}",
        "templates/service.yaml":
          "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}",
        "templates/_helpers.tpl":
          '{{- define "myapp.name" -}}\n{{- default .Chart.Name .Values.nameOverride | trunc 63 }}\n{{- end }}',
      },
    });
    const result = parseMultiFileOutput(wrapper);
    expect(Object.keys(result)).toHaveLength(5);
    expect(result["Chart.yaml"]).toContain("apiVersion: v2");
    expect(result["values.yaml"]).toContain("replicaCount");
    expect(result["templates/deployment.yaml"]).toContain("{{ .Release.Name }}");
    expect(result["templates/service.yaml"]).toContain("Service");
    expect(result["templates/_helpers.tpl"]).toContain("define");
  });
});

describe("parseMultiFileOutput — Terraform multi-file", () => {
  it("parses main.tf + variables.tf + outputs.tf", () => {
    const wrapper = JSON.stringify({
      files: {
        "main.tf": 'resource "aws_s3_bucket" "main" {\n  bucket = var.bucket_name\n}',
        "variables.tf":
          'variable "bucket_name" {\n  type = string\n  description = "S3 bucket name"\n}',
        "outputs.tf": 'output "bucket_arn" {\n  value = aws_s3_bucket.main.arn\n}',
      },
    });
    const result = parseMultiFileOutput(wrapper);
    expect(Object.keys(result)).toHaveLength(3);
    expect(result["main.tf"]).toContain("aws_s3_bucket");
    expect(result["variables.tf"]).toContain("variable");
    expect(result["outputs.tf"]).toContain("output");
  });
});

describe("parseMultiFileOutput — GitHub Actions multi-file", () => {
  it("parses workflow + composite action", () => {
    const wrapper = JSON.stringify({
      files: {
        ".github/workflows/ci.yml":
          "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4",
        ".github/actions/setup/action.yml":
          "name: Setup\ndescription: Setup environment\nruns:\n  using: composite\n  steps:\n    - run: npm ci\n      shell: bash",
      },
    });
    const result = parseMultiFileOutput(wrapper);
    expect(result[".github/workflows/ci.yml"]).toContain("actions/checkout@v4");
    expect(result[".github/actions/setup/action.yml"]).toContain("composite");
  });
});

describe("parseMultiFileOutput — fenced wrapper from LLM", () => {
  it("strips code fences before parsing multi-file JSON", () => {
    const json = JSON.stringify({
      files: {
        Makefile:
          ".PHONY: all build test\n\nall: build test\n\nbuild:\n\tgo build ./...\n\ntest:\n\tgo test ./...",
      },
    });
    const wrapped = "```json\n" + json + "\n```";
    const result = parseMultiFileOutput(wrapped);
    expect(result["Makefile"]).toContain(".PHONY");
    expect(result["Makefile"]).toContain("go build");
  });
});

// ── End-to-end: parse skill → validate structural rules ──────────────

describe("end-to-end: skill rules validate realistic output", () => {
  it("kubernetes rules pass a complete Deployment+Service combo", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "kubernetes.dops"));
    const rules = skill.frontmatter.verification?.structural ?? [];

    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "api", labels: { app: "api" } },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: "api" } },
        template: {
          metadata: { labels: { app: "api" } },
          spec: {
            containers: [
              {
                name: "api",
                image: "myapp:v1.2.0",
                ports: [{ containerPort: 8080 }],
                resources: {
                  limits: { memory: "256Mi", cpu: "500m" },
                  requests: { memory: "128Mi", cpu: "250m" },
                },
              },
            ],
          },
        },
      },
    };
    expect(validateStructure(deployment, rules)).toHaveLength(0);
  });

  it("docker-compose rules pass a multi-service compose", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "docker-compose.dops"));
    const rules = skill.frontmatter.verification?.structural ?? [];

    const compose = {
      services: {
        web: {
          build: ".",
          ports: ["3000:3000"],
          depends_on: ["db", "redis"],
        },
        db: {
          image: "postgres:16",
          volumes: ["pgdata:/var/lib/postgresql/data"],
        },
        redis: {
          image: "redis:7-alpine",
        },
      },
      volumes: {
        pgdata: {},
      },
    };
    expect(validateStructure(compose, rules)).toHaveLength(0);
  });

  it("gitlab-ci rules pass a multi-stage pipeline", () => {
    const skill = parseDopsFile(path.join(SKILLS_DIR, "gitlab-ci.dops"));
    const rules = skill.frontmatter.verification?.structural ?? [];

    const pipeline = {
      stages: ["build", "test", "deploy"],
      variables: { NODE_VERSION: "20" },
      build: {
        stage: "build",
        image: "node:20",
        script: ["npm ci", "npm run build"],
        artifacts: { paths: ["dist/"] },
      },
      test: {
        stage: "test",
        image: "node:20",
        script: ["npm test"],
      },
      deploy: {
        stage: "deploy",
        script: ["./deploy.sh"],
        only: ["main"],
      },
    };
    expect(validateStructure(pipeline, rules)).toHaveLength(0);
  });
});
