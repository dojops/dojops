# DevOps Skills

DojOps includes 18 built-in DevOps skills covering CI/CD, infrastructure-as-code, containers, monitoring, and system services. All skills follow a consistent pattern built on the `BaseSkill<T>` abstract class. Additionally, a **custom skill system** lets you extend DojOps with custom `.dops v2` skills.

> **As of v2.0.0, only `.dops v2` format is supported.** The legacy v1 format and `tool.yaml` manifests have been removed.

---

## Skill Overview

| Skill          | Output Format         | Output Files                        | Detector | Verifier             |
| -------------- | --------------------- | ----------------------------------- | -------- | -------------------- |
| GitHub Actions | YAML (raw)            | `.github/workflows/ci.yml`          | Yes      | Structure lint       |
| Terraform      | HCL (raw)             | `main.tf`, `variables.tf`           | Yes      | `terraform validate` |
| Kubernetes     | YAML (raw)            | K8s manifests                       | --       | `kubectl --dry-run`  |
| Helm           | YAML (raw)            | `Chart.yaml`, `values.yaml`         | --       | --                   |
| Ansible        | YAML (raw)            | `{name}.yml`                        | --       | --                   |
| Docker Compose | YAML (raw)            | `docker-compose.yml`                | Yes      | --                   |
| Dockerfile     | Dockerfile (raw)      | `Dockerfile`, `.dockerignore`       | Yes      | `hadolint`           |
| Nginx          | Nginx conf (raw)      | `nginx.conf`                        | --       | --                   |
| Makefile       | Make syntax (raw)     | `Makefile`                          | Yes      | --                   |
| GitLab CI      | YAML (raw)            | `.gitlab-ci.yml`                    | Yes      | Structure lint       |
| Prometheus     | YAML (raw)            | `prometheus.yml`, `alert-rules.yml` | --       | --                   |
| Systemd        | INI (raw)             | `{name}.service`                    | --       | --                   |
| Jenkinsfile    | Groovy (raw)          | `Jenkinsfile`                       | Yes      | --                   |
| Grafana        | JSON (raw)            | Grafana dashboard JSON              | --       | --                   |
| CloudFormation | YAML (raw)            | `template.yaml`                     | --       | Structure lint       |
| ArgoCD         | YAML (raw)            | ArgoCD Application manifests        | --       | --                   |
| Pulumi         | YAML/TypeScript (raw) | Pulumi IaC files                    | --       | --                   |
| OTel Collector | YAML (raw)            | `otel-collector-config.yaml`        | --       | Structure lint       |

---

## Skill Pattern

All 18 built-in skills are defined as `.dops v2` skill files in `packages/runtime/skills/`. Each skill is processed by `DopsRuntimeV2`, which compiles prompts, calls the LLM, and writes raw file content directly (no JSON→serialize step).

```
packages/runtime/skills/
  github-actions.dops    GitHub Actions workflow generator
  terraform.dops         Terraform HCL generator
  kubernetes.dops        Kubernetes manifest generator
  helm.dops              Helm chart generator
  ansible.dops           Ansible playbook generator
  docker-compose.dops    Docker Compose generator
  dockerfile.dops        Dockerfile generator
  nginx.dops             Nginx config generator
  makefile.dops           Makefile generator
  gitlab-ci.dops         GitLab CI pipeline generator
  prometheus.dops        Prometheus monitoring generator
  systemd.dops           Systemd service unit generator
  jenkinsfile.dops       Jenkinsfile pipeline generator
  grafana.dops           Grafana dashboard JSON generator
  cloudformation.dops    AWS CloudFormation template generator
  argocd.dops            ArgoCD Application manifest generator
  pulumi.dops            Pulumi infrastructure as code generator
  otel-collector.dops    OpenTelemetry Collector config generator
```

### BaseSkill Abstract Class

```typescript
abstract class BaseSkill<TInput> {
  abstract name: string;
  abstract inputSchema: z.ZodType<TInput>;

  // Zod validation of raw input
  validate(input: unknown): TInput;

  // LLM generation — returns structured data
  abstract generate(input: TInput): Promise<Result>;

  // Optional: write generated files to disk
  execute?(input: TInput): Promise<void>;

  // Optional: validate generated output with external tools
  verify?(data: unknown): Promise<VerificationResult>;
}
```

### Detector (`detector.ts`)

Optional filesystem detector that identifies project context:

- `GitHubActionsDetector` — Finds existing workflow files
- `TerraformDetector` — Detects `.tf` files
- `DockerfileDetector` — Checks for existing Dockerfile
- `DockerComposeDetector` — Checks for `docker-compose.yml`
- `MakefileDetector` — Checks for existing Makefile
- `GitLabCIDetector` — Checks for `.gitlab-ci.yml`

### Verifier (`verifier.ts`)

Optional validation of generated output. Five skills implement verification:

| Skill          | Verification Method           | Verification Command / Check                              |
| -------------- | ----------------------------- | --------------------------------------------------------- |
| Terraform      | External binary (`terraform`) | `terraform validate`                                      |
| Dockerfile     | External binary (`hadolint`)  | `hadolint Dockerfile`                                     |
| Kubernetes     | External binary (`kubectl`)   | `kubectl --dry-run=client`                                |
| GitHub Actions | Built-in structure lint       | Checks `on` trigger, `jobs`, `runs-on`, step `run`/`uses` |
| GitLab CI      | Built-in structure lint       | Checks job `script`, `stages` array, stage references     |

Verification runs by default in CLI commands. Use `--skip-verify` to disable. Built-in verifiers always run.

**Auto-install of missing binaries:** When an external verification binary (e.g. `terraform`, `hadolint`, `kubectl`) is not found on the system, DojOps automatically installs it via `dojops toolchain install` and retries verification. This eliminates the need to manually install verification tools before use. The `OnBinaryMissing` callback pattern propagates from the CLI through `skill-registry` and `runtime` to the binary verifier, triggering automatic installation on first encounter.

**Dynamic filename resolution:** Verification commands support the `{entryFile}` placeholder, which resolves to the actual output filename at runtime. For example, a verification command `hadolint {entryFile}` will resolve to `hadolint Dockerfile` based on the generated file path.

### Existing Config Auto-Detection

All 18 skills auto-detect existing config files and switch to update mode when found. Each skill knows its output file path and reads existing content automatically:

| Skill          | Auto-Detect Path                                                       |
| -------------- | ---------------------------------------------------------------------- |
| GitHub Actions | `{projectPath}/.github/workflows/ci.yml`                               |
| Terraform      | `{projectPath}/main.tf`                                                |
| Kubernetes     | `{outputPath}/{appName}.yaml`                                          |
| Helm           | `{outputPath}/{chartName}/values.yaml`                                 |
| Ansible        | `{outputPath}/{playbookName}.yml`                                      |
| Docker Compose | `{projectPath}/docker-compose.yml` (+ `.yaml`, `compose.yml` variants) |
| Dockerfile     | `{outputPath}/Dockerfile` then `{projectPath}/Dockerfile`              |
| Nginx          | `{outputPath}/nginx.conf`                                              |
| Makefile       | `{projectPath}/Makefile`                                               |
| GitLab CI      | `{projectPath}/.gitlab-ci.yml`                                         |
| Prometheus     | `{outputPath}/prometheus.yml`                                          |
| Systemd        | `{outputPath}/{serviceName}.service`                                   |
| Jenkinsfile    | `{projectPath}/Jenkinsfile`                                            |

**Behavior:**

1. If `existingContent` is explicitly passed in the input, it takes priority over auto-detection
2. Otherwise, the skill reads the file at the auto-detect path using `readExistingConfig()` (from `@dojops/sdk`)
3. Files larger than 50KB are skipped (returns `null`)
4. The `generate()` output includes `isUpdate: boolean` so callers (CLI, planner) can distinguish create vs update

### Atomic File Writes

All skill `execute()` methods use `atomicWriteFileSync()` from `@dojops/sdk`. This writes to a temporary file first, then atomically renames it to the target path using `fs.renameSync` (POSIX atomic rename). This prevents corrupted or partial files if the process crashes mid-write.

### Backup Before Overwrite

When `execute()` writes to a file that already exists, it creates a `.bak` backup first using `backupFile()` from `@dojops/sdk`. For example:

- `main.tf` → `main.tf.bak`
- `.github/workflows/ci.yml` → `.github/workflows/ci.yml.bak`

Backups are only created when updating existing files, not when creating new ones. The `.bak` files are used by `dojops rollback` to restore the original content.

### File Tracking

All skill `execute()` methods return `filesWritten` and `filesModified` arrays in the `SkillOutput`:

- `filesWritten` — All files written during execution (both new and updated)
- `filesModified` — Files that existed before and were overwritten (have `.bak` backups)

This metadata flows through the executor into audit entries and execution logs, enabling precise rollback (delete new files, restore `.bak` for modified files).

### Idempotent YAML Output

All YAML generators use shared dump options with `sortKeys: true` for deterministic output. Running the same generation twice produces identical YAML, eliminating diff noise from key reordering.

GitHub Actions uses a custom key sort function that preserves the conventional top-level key order (`name` → `on` → `permissions` → `env` → `jobs`) while sorting all other keys alphabetically.

**VerificationResult:**

```typescript
interface VerificationResult {
  valid: boolean;
  issues: VerificationIssue[];
}

interface VerificationIssue {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  file?: string;
}
```

---

## Skill Details

### GitHub Actions

Generates GitHub Actions workflow files (`.github/workflows/ci.yml`).

- **Serialization:** `js-yaml`
- **Detector:** Finds existing workflow files in `.github/workflows/`
- **Verifier:** Built-in structure lint — validates `on` trigger, `jobs` section, `runs-on` per job (skipped for reusable workflow jobs with `uses`), step `run`/`uses` presence
- **Output:** Complete workflow YAML with jobs, steps, triggers

### Terraform

Generates Terraform HCL configurations.

- **Serialization:** Custom HCL builder
- **Detector:** Detects existing `.tf` files
- **Verifier:** `terraform validate` — checks HCL syntax and provider requirements
- **Output:** `main.tf` (resources), `variables.tf` (input variables)

### Kubernetes

Generates Kubernetes manifests (Deployments, Services, ConfigMaps, etc.).

- **Serialization:** `js-yaml`
- **Verifier:** `kubectl --dry-run=client` — validates manifest structure
- **Output:** YAML manifests

### Helm

Generates Helm chart structures.

- **Serialization:** `js-yaml`
- **Output:** `Chart.yaml`, `values.yaml`

### Ansible

Generates Ansible playbooks.

- **Serialization:** `js-yaml`
- **Output:** `{name}.yml` playbook

### Docker Compose

Generates Docker Compose configurations.

- **Serialization:** `js-yaml`
- **Detector:** Checks for existing `docker-compose.yml`
- **Output:** `docker-compose.yml`

### Dockerfile

Generates optimized Dockerfiles with multi-stage builds.

- **Serialization:** Custom string builder
- **Detector:** Checks for existing Dockerfile
- **Verifier:** `hadolint` — lints Dockerfile for best practices
- **Output:** `Dockerfile`, `.dockerignore`

### Nginx

Generates Nginx server configurations.

- **Serialization:** Custom string builder
- **Output:** `nginx.conf`

### Makefile

Generates Makefiles with proper tab indentation.

- **Serialization:** Custom string builder (with tabs)
- **Detector:** Checks for existing Makefile
- **Output:** `Makefile`

### GitLab CI

Generates GitLab CI pipeline configurations.

- **Serialization:** `js-yaml`
- **Detector:** Checks for existing `.gitlab-ci.yml`
- **Verifier:** Built-in structure lint — validates `stages` is an array, jobs have `script` (or `trigger`/`extends`), stage references are declared, hidden jobs (`.prefix`) are skipped
- **Output:** `.gitlab-ci.yml`

### Prometheus

Generates Prometheus monitoring and alerting configurations.

- **Serialization:** `js-yaml`
- **Output:** `prometheus.yml`, `alert-rules.yml`

### Systemd

Generates systemd service unit files.

- **Serialization:** Custom string builder (INI format)
- **Output:** `{name}.service`

---

## Creating a New Skill

To add a new built-in skill to DojOps, create a `.dops v2` file in `packages/runtime/skills/`. See the existing skills for the format. For custom skills, use `dojops skills init <name>` to scaffold a new `.dops v2` file.

---

## DOPS Skill Format

Built-in skills are defined as `.dops` skill files — a declarative format combining YAML frontmatter with markdown prompt sections. The `@dojops/runtime` package processes these skills through `DopsRuntime` (v2-only as of v2.0.0).

### Frontmatter Sections

All sections are defined in YAML between `---` delimiters:

| Section        | Required | Description                                                            |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `dops`         | Yes      | Version identifier (`v2`)                                              |
| `kind`         | No       | Skill kind (`tool`, default: `tool`)                                   |
| `meta`         | Yes      | Skill name, version, description, author, license, tags, repository    |
| `context`      | Yes      | Technology context, output guidance, best practices, Context7 libs     |
| `files`        | Yes      | Output file specs (path templates, format, serialization options)      |
| `scope`        | No       | Write boundary — explicit list of allowed write paths                  |
| `risk`         | No       | Skill risk self-classification (`LOW` / `MEDIUM` / `HIGH` + rationale) |
| `execution`    | No       | Mutation semantics (mode, deterministic, idempotent flags)             |
| `update`       | No       | Structured update behavior (strategy, inputSource, injectAs)           |
| `detection`    | No       | Existing file detection paths for auto-update mode                     |
| `verification` | No       | Structural rules + optional binary verification command                |
| `permissions`  | No       | Filesystem, child_process, and network permission declarations         |

### Context Block (v2)

The `context` block provides technology context and generation guidance to the LLM:

```yaml
context:
  technology: "GitHub Actions"
  fileFormat: yaml
  outputGuidance: "Generate a complete GitHub Actions workflow YAML file..."
  bestPractices:
    - "Use matrix strategy for multi-version testing"
    - "Pin action versions with full SHA hashes"
  context7Libraries:
    - name: "github-actions"
      query: "workflow syntax and configuration"
```

| Field               | Type     | Description                                                |
| ------------------- | -------- | ---------------------------------------------------------- |
| `technology`        | string   | Technology name (e.g. "GitHub Actions", "Terraform")       |
| `fileFormat`        | string   | Output file format (e.g. `yaml`, `hcl`, `raw`)             |
| `outputGuidance`    | string   | Instructions for the LLM on what to generate               |
| `bestPractices`     | string[] | Best practices injected into the prompt                    |
| `context7Libraries` | array    | Context7 library references for documentation augmentation |

### Prompt Variables (v2)

v2 prompts support additional template variables:

| Variable           | Source                    | Description                                    |
| ------------------ | ------------------------- | ---------------------------------------------- |
| `{outputGuidance}` | `context.outputGuidance`  | Generation instructions from the context block |
| `{bestPractices}`  | `context.bestPractices`   | Numbered list of best practices                |
| `{context7Docs}`   | Context7 API (runtime)    | Documentation fetched via `DocProvider`        |
| `{projectContext}` | Project scanner (runtime) | Detected project context information           |

The `DocProvider` interface enables Context7 integration for v2 tools, fetching relevant documentation at runtime based on `context7Libraries` entries.

### File Spec Fields

Each entry in the `files` array defines an output file:

| Field         | Type    | Default | Description                                      |
| ------------- | ------- | ------- | ------------------------------------------------ |
| `path`        | string  | —       | Output path (supports `{var}` templates)         |
| `format`      | string  | `raw`   | File format (`raw` is standard for v2)           |
| `conditional` | boolean | —       | Only write if LLM produces content for this file |

Skills use `format: "raw"` exclusively. The LLM generates raw file content directly, and the runtime strips code fences via `stripCodeFences()` before writing.

### Scope — Write Boundary Enforcement

The `scope` section declares which files a skill is allowed to write. Paths use the same `{var}` template syntax as `files[].path`:

```yaml
scope:
  write: ["{outputPath}/main.tf", "{outputPath}/variables.tf"]
```

At execution time, resolved file paths are validated against the expanded scope patterns. Writes to paths not in `scope.write` are rejected with an error. Path traversal (`..`) in scope patterns is rejected at parse time.

When `scope` is omitted, the skill can write to any path.

### Risk — Skill Self-Classification

Skills declare their own risk level:

```yaml
risk:
  level: MEDIUM
  rationale: "Infrastructure changes may affect cloud resources"
```

| Level    | Typical Use Cases                                              |
| -------- | -------------------------------------------------------------- |
| `LOW`    | CI/CD, monitoring, build automation (github-actions, makefile) |
| `MEDIUM` | Infrastructure, containers, deployments (terraform, k8s)       |
| `HIGH`   | Production resources, IAM, security configurations             |

Default when not declared: `LOW` with rationale "No risk classification declared". The risk level is exposed via `DopsRuntime.metadata.riskLevel` for use by planners and approval workflows.

### Execution — Mutation Semantics

```yaml
execution:
  mode: generate # "generate" or "update"
  deterministic: false # same input always produces same output?
  idempotent: true # safe to re-run without side effects?
```

All fields have defaults: `mode: "generate"`, `deterministic: false`, `idempotent: false`.

### Update — Structured Update Behavior

```yaml
update:
  strategy: replace # "replace" or "preserve_structure"
  inputSource: file # where existing content comes from
  injectAs: existingContent # variable name for existing content in prompts
```

When `strategy` is `preserve_structure`, the prompt compiler injects additional instructions to maintain the existing configuration's organization. The `injectAs` field controls the variable name used in update prompts (default: `existingContent`).

### Markdown Sections

After the closing `---` delimiter, markdown sections define prompts:

- `## Prompt` (required) — Main generation prompt with `{var}` template substitution
- `## Keywords` (required) — Comma-separated keywords for agent routing

### Built-in Skill Risk Levels

| Skill          | Risk   | Rationale                                             |
| -------------- | ------ | ----------------------------------------------------- |
| terraform      | MEDIUM | Infrastructure changes may affect cloud resources     |
| kubernetes     | MEDIUM | Cluster configuration changes affect running services |
| helm           | MEDIUM | Chart changes affect Kubernetes deployments           |
| dockerfile     | MEDIUM | Build image changes may affect production runtime     |
| docker-compose | LOW    | Compose changes are local development configurations  |
| ansible        | MEDIUM | Playbook changes execute on remote hosts              |
| nginx          | MEDIUM | Web server config changes affect traffic routing      |
| systemd        | MEDIUM | Service unit changes affect system processes          |
| github-actions | LOW    | CI/CD workflow changes require PR review              |
| gitlab-ci      | LOW    | CI/CD pipeline changes require MR review              |
| makefile       | LOW    | Build automation changes are local                    |
| prometheus     | LOW    | Monitoring config changes are observable              |
| grafana        | LOW    | Dashboard JSON changes are observable                 |
| cloudformation | MEDIUM | CloudFormation changes affect AWS infrastructure      |
| argocd         | MEDIUM | ArgoCD changes affect Kubernetes deployments          |
| pulumi         | MEDIUM | Infrastructure changes may affect cloud resources     |
| otel-collector | LOW    | Collector config changes affect telemetry pipeline    |

---

## Custom Skill System

DojOps supports custom skills via the `@dojops/skill-registry` custom skill system. Custom skills are discovered automatically and behave exactly like built-in skills — they go through the same Planner, Executor, verification, and audit pipeline.

### Custom Skill Discovery

Custom skills are discovered from two locations (in priority order):

1. **Project skills:** `.dojops/skills/<name>.dops` (highest priority)
2. **Global skills:** `~/.dojops/skills/<name>.dops`

Project skills override global skills of the same name. Custom skill discovery happens automatically on every command — no manual registration needed.

### Custom Skill CLI Commands

```bash
# List all discovered custom skills (global + project)
dojops skills list

# Validate a skill manifest
dojops skills validate .dojops/skills/my-skill/

# Scaffold a new .dops skill (uses AI when provider is configured)
dojops skills init my-skill

# Publish a .dops skill to DojOps Hub (requires DOJOPS_HUB_TOKEN)
dojops skills publish my-skill.dops
dojops skills publish my-skill.dops --changelog "Added Docker support"

# Install a .dops skill from DojOps Hub
dojops skills install nginx-config
dojops skills install nginx-config --version 1.0.0 --global

# Search the DojOps Hub for skills
dojops skills search docker
dojops skills search terraform --limit 5
dojops skills search k8s --output json
```

#### Hub Integration

The `publish` and `install` commands connect to the [DojOps Hub](https://hub.dojops.ai) — a skill marketplace where users share `.dops` skills.

##### Authentication Setup

Publishing skills to the Hub requires an API token. Tokens follow the GitHub PAT model — shown once at creation, stored as SHA-256 hashes.

**1. Sign in to the Hub** — Go to [hub.dojops.ai](https://hub.dojops.ai) and sign in with your GitHub account.

**2. Generate a token** — Navigate to **Settings → API Tokens** (`/settings/tokens`), or click "Settings" in the navbar.

**3. Create a named token** — Give your token a descriptive name (e.g. "My laptop", "CI/CD pipeline") and choose an expiration:

| Expiration    | Duration | Use Case            |
| ------------- | -------- | ------------------- |
| 1 month       | 30 days  | Short-lived tasks   |
| 3 months      | 90 days  | Regular development |
| No expiration | Never    | CI/CD pipelines     |

**4. Copy the token** — The raw token (format: `dojops_` + 40 hex chars) is displayed **once**. Copy it immediately — you won't be able to see it again.

**5. Set the environment variable:**

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc)
export DOJOPS_HUB_TOKEN="dojops_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
```

You can manage up to 10 tokens per account. View active tokens, their last-used timestamps, and revoke compromised tokens from the Settings page at any time.

##### Publishing a Skill

The publish flow validates locally, computes a SHA-256 hash for integrity, and uploads to the Hub.

```bash
# Publish a .dops file
dojops skills publish my-skill.dops

# Publish with a changelog message
dojops skills publish my-skill.dops --changelog "Added Docker support"

# Publish by skill name (looks up in .dojops/skills/)
dojops skills publish my-skill
```

**What happens during publish:**

1. **Local validation** — The `.dops` file is parsed and validated against the .dops v2 spec (frontmatter, sections, Zod schemas)
2. **SHA-256 hash** — The CLI computes a SHA-256 hash of the file as a **publisher attestation**
3. **Upload** — The file and hash are sent to the Hub via `POST /api/packages` with `Authorization: Bearer <token>`
4. **Server verification** — The Hub recomputes the hash and compares it against the client-provided hash. Mismatches are rejected
5. **Storage** — The Hub stores the file and the publisher's hash for download integrity verification

**Example output:**

```
◇  Validated: my-tool v1.0.0
◇  SHA256: a1b2c3d4e5f6...
┌  Published new skill
│  Name:    my-tool
│  Version: v1.0.0
│  Slug:    my-tool
│  SHA256:  a1b2c3d4e5f6...
│  URL:     https://hub.dojops.ai/packages/my-tool
└
```

**Publishing a new version** of an existing skill uses the same command — the Hub detects the existing package and adds the new version:

```bash
# Update version in .dops frontmatter, then:
dojops skills publish my-skill.dops --changelog "v1.1.0: Added Redis support"
```

##### Installing a Skill

The install flow downloads the skill, verifies its integrity against the publisher's hash, and places it in your skills directory.

```bash
# Install latest version (project-local)
dojops skills install nginx-config

# Install a specific version
dojops skills install nginx-config --version 1.0.0

# Install globally (~/.dojops/skills/)
dojops skills install nginx-config --global
```

**What happens during install:**

1. **Fetch metadata** — The CLI queries `GET /api/packages/<slug>` to resolve the latest version (unless `--version` is specified)
2. **Download** — The `.dops` file is downloaded from `GET /api/download/<slug>/<version>` with the publisher's SHA-256 hash in the `X-Checksum-Sha256` response header
3. **Integrity check** — The CLI recomputes the SHA-256 hash locally and compares it against the publisher's hash. **Mismatches abort the install** with a tampering warning
4. **Validation** — The downloaded file is parsed and validated as a `.dops` skill
5. **Write** — The file is saved to `.dojops/skills/<name>.dops` (project) or `~/.dojops/skills/<name>.dops` (global)

**Example output:**

```
◇  Downloading nginx-config v1.0.0...
┌  Skill installed
│  Name:    nginx-config
│  Version: v1.0.0
│  Path:    .dojops/skills/nginx-config.dops
│  Scope:   project
│  SHA256:  f9e8d7c6b5a4...
│  Verify:  OK — matches publisher hash
└
```

**Integrity failure example** (file tampered with):

```
✖  SHA256 integrity check failed! The downloaded file does not match the publisher's hash.
   Publisher: f9e8d7c6b5a4...
   Download:  0000aaaa1111...
   This may indicate the file was tampered with. Aborting install.
```

##### Environment Variables

| Variable           | Description                                                | Default                 |
| ------------------ | ---------------------------------------------------------- | ----------------------- |
| `DOJOPS_HUB_URL`   | Hub API base URL                                           | `https://hub.dojops.ai` |
| `DOJOPS_HUB_TOKEN` | API token for publishing (generated at `/settings/tokens`) | —                       |

### Skill Policy

Control which custom skills are allowed via `.dojops/policy.yaml`:

```yaml
# Only allow specific skills
allowedSkills:
  - my-tool
  - another-tool

# Block specific skills (takes precedence over allowedSkills)
blockedSkills:
  - untrusted-tool
```

### Skill Isolation

Custom skills are sandboxed with the same guardrails as built-in skills, plus additional controls:

- **Verification command whitelist** — Only 33 known DevOps binaries are allowed (terraform, kubectl, helm, ansible-lint, ansible-playbook, docker, hadolint, yamllint, jsonlint, shellcheck, tflint, kubeval, conftest, checkov, trivy, kube-score, polaris, nginx, promtool, systemd-analyze, make, actionlint, caddy, haproxy, nomad, podman, fluentd, opa, vault, circleci, npx, tsc, cfn-lint). Non-whitelisted commands are rejected at runtime
- **Permission enforcement** — The `permissions.child_process` field must be `"required"` for verification commands to execute. Omitted or `"none"` means the command is silently skipped (default-safe)
- **Path traversal prevention** — File paths in `files[].path` and `detector.path` cannot contain `..` segments, preventing writes outside the project directory
- **Execution guardrails** — Custom skills execute through the same `SafeExecutor` pipeline as built-in skills, inheriting `maxFileSize` (1MB default), `timeoutMs` (30s default), DevOps write allowlist enforcement, and per-file audit logging

### Custom Skill Audit Trail

Custom skill executions include additional audit metadata:

- `toolType: "custom"` — distinguishes from built-in skills
- `toolSource: "global" | "project"` — where the custom skill was discovered
- `toolVersion` — version from the manifest
- `toolHash` — SHA-256 hash of skill directory for integrity verification
- `systemPromptHash` — SHA-256 hash of the custom skill's system prompt for reproducibility tracking
