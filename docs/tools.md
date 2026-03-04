# DevOps Tools

DojOps includes 12 built-in DevOps tools covering CI/CD, infrastructure-as-code, containers, monitoring, and system services. All tools follow a consistent pattern built on the `BaseTool<T>` abstract class. Additionally, a **custom tool system** lets you extend DojOps with custom tools via declarative `tool.yaml` manifests.

---

## Tool Overview

| Tool           | Output Format     | Output Files                        | Detector | Verifier             |
| -------------- | ----------------- | ----------------------------------- | -------- | -------------------- |
| GitHub Actions | YAML (raw)        | `.github/workflows/ci.yml`          | Yes      | Structure lint       |
| Terraform      | HCL (raw)         | `main.tf`, `variables.tf`           | Yes      | `terraform validate` |
| Kubernetes     | YAML (raw)        | K8s manifests                       | --       | `kubectl --dry-run`  |
| Helm           | YAML (raw)        | `Chart.yaml`, `values.yaml`         | --       | --                   |
| Ansible        | YAML (raw)        | `{name}.yml`                        | --       | --                   |
| Docker Compose | YAML (raw)        | `docker-compose.yml`                | Yes      | --                   |
| Dockerfile     | Dockerfile (raw)  | `Dockerfile`, `.dockerignore`       | Yes      | `hadolint`           |
| Nginx          | Nginx conf (raw)  | `nginx.conf`                        | --       | --                   |
| Makefile       | Make syntax (raw) | `Makefile`                          | Yes      | --                   |
| GitLab CI      | YAML (raw)        | `.gitlab-ci.yml`                    | Yes      | Structure lint       |
| Prometheus     | YAML (raw)        | `prometheus.yml`, `alert-rules.yml` | --       | --                   |
| Systemd        | INI (raw)         | `{name}.service`                    | --       | --                   |

---

## Tool Pattern

All 12 built-in tools are defined as `.dops v2` module files in `packages/runtime/modules/`. Each module is processed by `DopsRuntimeV2`, which compiles prompts, calls the LLM, and writes raw file content directly (no JSON→serialize step).

```
packages/runtime/modules/
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
```

> **Legacy pattern (v1):** Prior to v2, built-in tools used a TypeScript file structure (`schemas.ts` → `detector.ts` → `generator.ts` → `verifier.ts` → `*-tool.ts`). This pattern is still supported for custom tools via `tool.yaml` manifests.

### BaseTool Abstract Class

```typescript
abstract class BaseTool<TInput> {
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

### Schemas (`schemas.ts`) — v1 Legacy

> **Note:** v2 tools use the `context` block instead of separate input/output schemas. The LLM generates raw file content directly — there is no output schema validation step.

In v1, each tool defines Zod schemas for its input and output:

- **Input schema** — Validates user/planner input before generation. All input schemas include an optional `existingContent` field for passing existing config content to update/enhance
- **Output schema** — Validates LLM response structure before serialization

### Detector (`detector.ts`)

Optional filesystem detector that identifies project context:

- `GitHubActionsDetector` — Finds existing workflow files
- `TerraformDetector` — Detects `.tf` files
- `DockerfileDetector` — Checks for existing Dockerfile
- `DockerComposeDetector` — Checks for `docker-compose.yml`
- `MakefileDetector` — Checks for existing Makefile
- `GitLabCIDetector` — Checks for `.gitlab-ci.yml`

### Generator (`generator.ts`) — v1 Legacy

> **Note:** v2 tools define generation prompts in the `.dops` file's `## Prompt` section. The LLM generates raw file content directly, and `DopsRuntimeV2` strips code fences before writing.

In v1, generators call the LLM with a structured Zod schema, parse the response, and serialize to the target format (YAML, HCL, Dockerfile syntax, INI, etc.).

All v1 generators accept an optional `existingContent?: string` parameter. When provided:

- The **system prompt** switches from "Generate a new config" to "Update the existing config. Preserve existing structure and settings."
- The **user prompt** appends the existing content in a delimited block (`--- EXISTING CONFIGURATION ---`)
- This enables tools to enhance existing configs rather than replacing them from scratch

### Verifier (`verifier.ts`)

Optional validation of generated output. Five tools implement verification:

| Tool           | Verification Method           | Verification Command / Check                              |
| -------------- | ----------------------------- | --------------------------------------------------------- |
| Terraform      | External binary (`terraform`) | `terraform validate`                                      |
| Dockerfile     | External binary (`hadolint`)  | `hadolint Dockerfile`                                     |
| Kubernetes     | External binary (`kubectl`)   | `kubectl --dry-run=client`                                |
| GitHub Actions | Built-in structure lint       | Checks `on` trigger, `jobs`, `runs-on`, step `run`/`uses` |
| GitLab CI      | Built-in structure lint       | Checks job `script`, `stages` array, stage references     |

Verification runs by default in CLI commands. Use `--skip-verify` to disable. External binary checks gracefully skip if the binary is not installed. Built-in verifiers always run.

### Existing Config Auto-Detection

All 12 tools auto-detect existing config files and switch to update mode when found. Each tool knows its output file path and reads existing content automatically:

| Tool           | Auto-Detect Path                                                       |
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

**Behavior:**

1. If `existingContent` is explicitly passed in the input, it takes priority over auto-detection
2. Otherwise, the tool reads the file at the auto-detect path using `readExistingConfig()` (from `@dojops/sdk`)
3. Files larger than 50KB are skipped (returns `null`)
4. The `generate()` output includes `isUpdate: boolean` so callers (CLI, planner) can distinguish create vs update

### Atomic File Writes

All tool `execute()` methods use `atomicWriteFileSync()` from `@dojops/sdk`. This writes to a temporary file first, then atomically renames it to the target path using `fs.renameSync` (POSIX atomic rename). This prevents corrupted or partial files if the process crashes mid-write.

### Backup Before Overwrite

When `execute()` writes to a file that already exists, it creates a `.bak` backup first using `backupFile()` from `@dojops/sdk`. For example:

- `main.tf` → `main.tf.bak`
- `.github/workflows/ci.yml` → `.github/workflows/ci.yml.bak`

Backups are only created when updating existing files, not when creating new ones. The `.bak` files are used by `dojops rollback` to restore the original content.

### File Tracking

All tool `execute()` methods return `filesWritten` and `filesModified` arrays in the `ToolOutput`:

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

## Tool Details

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

## Creating a New Tool

To add a new tool to DojOps:

1. **Create the directory:** `packages/tools/src/my-tool/`

2. **Define schemas** (`schemas.ts`):

   ```typescript
   import { z } from "@dojops/sdk";
   export const MyToolInputSchema = z.object({
     /* tool-specific fields */
     existingContent: z
       .string()
       .optional()
       .describe(
         "Existing config file content to update/enhance. If omitted, tool auto-detects existing files.",
       ),
   });
   export const MyToolOutputSchema = z.object({
     /* ... */
   });
   ```

3. **Implement the generator** (`generator.ts`):

   ```typescript
   export async function generateMyTool(input, provider, existingContent?: string) {
     const isUpdate = !!existingContent;
     const system = isUpdate
       ? "Update the existing config. Preserve existing structure and settings."
       : "Generate a new config from scratch.";
     const prompt = isUpdate
       ? `${buildPrompt(input)}\n\n--- EXISTING CONFIGURATION ---\n${existingContent}\n--- END ---`
       : buildPrompt(input);
     const response = await provider.generate({ system, prompt, schema: MyToolOutputSchema });
     return parseAndValidate(response.content, MyToolOutputSchema);
   }
   ```

4. **Create the tool class** (`my-tool.ts`):

   ```typescript
   import { BaseTool, readExistingConfig, backupFile, atomicWriteFileSync } from "@dojops/sdk";
   export class MyTool extends BaseTool<MyToolInput> {
     name = "my-tool";
     inputSchema = MyToolInputSchema;
     async generate(input) {
       const existingContent = input.existingContent ?? readExistingConfig(outputPath);
       const isUpdate = !!existingContent;
       const result = await generateMyTool(input, this.provider, existingContent);
       return { success: true, data: { ...result, isUpdate } };
     }
     async execute(input) {
       const result = await this.generate(input);
       if (result.data.isUpdate) backupFile(outputPath);
       atomicWriteFileSync(outputPath, result.data.content);
       return {
         ...result,
         filesWritten: [outputPath],
         filesModified: result.data.isUpdate ? [outputPath] : [],
       };
     }
   }
   ```

5. **Add optional detector** (`detector.ts`) and **verifier** (`verifier.ts`).

6. **Export from index** (`index.ts`) and add to the tools barrel export in `packages/tools/src/index.ts`.

7. **Write tests** (`my-tool.test.ts`) — include tests for auto-detection, update mode prompts, and backup creation.

---

## DOPS Module Format

Built-in tools are defined as `.dops` module files — a declarative format combining YAML frontmatter with markdown prompt sections. The `@dojops/runtime` package processes these modules through two runtime engines: `DopsRuntime` (v1) and `DopsRuntimeV2` (v2). Version detection is automatic via `parseDopsStringAny()` and `parseDopsFileAny()`.

### Frontmatter Sections

All sections are defined in YAML between `---` delimiters:

| Section        | Required    | Description                                                           |
| -------------- | ----------- | --------------------------------------------------------------------- |
| `dops`         | Yes         | Version identifier (`v1` or `v2`)                                     |
| `kind`         | No          | Module kind (`tool`, default: `tool`)                                 |
| `meta`         | Yes         | Tool name, version, description, author, license, tags, repository    |
| `input`        | v1 only     | Input field definitions with types, constraints, defaults             |
| `output`       | v1 only     | JSON Schema for LLM output validation                                 |
| `context`      | v2 required | Technology context, output guidance, best practices, Context7 libs    |
| `files`        | Yes         | Output file specs (path templates, format, serialization options)     |
| `scope`        | No          | Write boundary — explicit list of allowed write paths                 |
| `risk`         | No          | Tool risk self-classification (`LOW` / `MEDIUM` / `HIGH` + rationale) |
| `execution`    | No          | Mutation semantics (mode, deterministic, idempotent flags)            |
| `update`       | No          | Structured update behavior (strategy, inputSource, injectAs)          |
| `detection`    | No          | Existing file detection paths for auto-update mode                    |
| `verification` | No          | Structural rules + optional binary verification command               |
| `permissions`  | No          | Filesystem, child_process, and network permission declarations        |

> **Version detection:** `parseDopsStringAny()` and `parseDopsFileAny()` read the `dops` field to determine format version. v1 modules use `DopsRuntime`; v2 modules use `DopsRuntimeV2`.

### Context Block (v2)

The `context` block replaces v1's `input` and `output` sections. It provides technology context and generation guidance to the LLM:

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

| Field           | Type    | Default | Description                                           |
| --------------- | ------- | ------- | ----------------------------------------------------- |
| `path`          | string  | —       | Output path (supports `{var}` templates)              |
| `format`        | string  | `raw`   | `hcl`, `yaml`, `json`, `raw`, `ini`, `toml`           |
| `source`        | string  | `llm`   | v1 only: `llm` (LLM-generated) or `template` (static) |
| `content`       | string  | —       | v1 only: Static content when `source: template`       |
| `multiDocument` | boolean | —       | v1 only: Multi-document YAML (`---` separated)        |
| `dataPath`      | string  | —       | v1 only: JSON path to extract from LLM output         |
| `conditional`   | boolean | —       | Only write if LLM produces content for this file      |
| `options`       | object  | —       | v1 only: Serialization options (see below)            |

> **v2 note:** v2 tools use `format: "raw"` exclusively. The LLM generates raw file content directly, and `DopsRuntimeV2` strips code fences via `stripCodeFences()` before writing.

**Serialization options** (`options`, v1 only):

| Field           | Type     | Description                          |
| --------------- | -------- | ------------------------------------ |
| `mapAttributes` | string[] | YAML attributes to serialize as maps |
| `keyOrder`      | string[] | Preferred top-level key ordering     |
| `sortKeys`      | boolean  | Sort all keys alphabetically         |
| `lineWidth`     | number   | YAML line width                      |
| `noRefs`        | boolean  | Disable YAML anchor references       |
| `indent`        | number   | Indentation level                    |

### Scope — Write Boundary Enforcement

The `scope` section declares which files a tool is allowed to write. Paths use the same `{var}` template syntax as `files[].path`:

```yaml
scope:
  write: ["{outputPath}/main.tf", "{outputPath}/variables.tf"]
```

At execution time, resolved file paths are validated against the expanded scope patterns. Writes to paths not in `scope.write` are rejected with an error. Path traversal (`..`) in scope patterns is rejected at parse time.

When `scope` is omitted, the tool can write to any path (backward compatible with existing tools).

### Risk — Tool Self-Classification

Tools declare their own risk level:

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

> **v1 note:** v1 tools may also include `## Update Prompt`, `## Examples`, and `## Constraints`. These sections are not used by the v2 prompt compiler — use `context.bestPractices` for constraints and Context7 for documentation examples.

### Built-in Module Risk Levels

| Tool           | Risk   | Rationale                                             |
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

---

## Custom Module System

DojOps supports custom modules via the `@dojops/tool-registry` custom module system. Custom modules are discovered automatically and behave exactly like built-in modules — they go through the same Planner, Executor, verification, and audit pipeline.

### Custom Module Discovery

Custom modules are discovered from three locations (in priority order):

1. **Project modules:** `.dojops/modules/<name>/tool.yaml` (highest priority)
2. **Project tools (fallback):** `.dojops/tools/<name>/tool.yaml`
3. **Global modules:** `~/.dojops/modules/<name>/tool.yaml`
4. **Global tools (fallback):** `~/.dojops/tools/<name>/tool.yaml`

Project modules override global modules of the same name. Custom module discovery happens automatically on every command — no manual registration needed.

### Module Manifest (`tool.yaml`)

Each custom module is a directory containing a `tool.yaml` manifest and a JSON Schema file:

```yaml
spec: 1
name: my-tool
version: 1.0.0
type: tool
description: "Generates configuration for My Tool"
inputSchema: input.schema.json

generator:
  strategy: llm
  systemPrompt: |
    You are a My Tool configuration expert.
    Generate valid My Tool configuration based on the user's requirements.
  updateMode: true
  existingDelimiter: "--- EXISTING CONFIGURATION ---"

files:
  - path: my-tool.yml
    serializer: yaml

verification:
  command: my-tool validate --config my-tool.yml

detector:
  path: my-tool.yml

tags:
  - configuration
  - my-tool

permissions:
  filesystem: project
  network: none
  child_process: required
```

### Input Schema (`input.schema.json`)

A JSON Schema file defining the custom tool's input parameters:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Application name" },
    "environment": {
      "type": "string",
      "enum": ["development", "staging", "production"],
      "default": "development"
    }
  },
  "required": ["name"]
}
```

JSON Schema inputs are converted to Zod schemas at runtime, ensuring full compatibility with the Planner's `zodSchemaToText()` and the Executor's validation pipeline.

### Custom Module CLI Commands

```bash
# List all discovered custom modules (global + project)
dojops modules list

# Validate a module manifest
dojops modules validate .dojops/modules/my-module/

# Scaffold a new custom module with template files
dojops modules init my-module

# Publish a .dops module to DojOps Hub (requires DOJOPS_HUB_TOKEN)
dojops modules publish my-module.dops
dojops modules publish my-module.dops --changelog "Added Docker support"

# Install a .dops module from DojOps Hub
dojops modules install nginx-config
dojops modules install nginx-config --version 1.0.0 --global

# Search the DojOps Hub for modules
dojops modules search docker
dojops modules search terraform --limit 5
dojops modules search k8s --output json
```

#### Hub Integration

The `publish` and `install` commands connect to the [DojOps Hub](https://hub.dojops.ai) — a module marketplace where users share `.dops` modules.

##### Authentication Setup

Publishing modules to the Hub requires an API token. Tokens follow the GitHub PAT model — shown once at creation, stored as SHA-256 hashes.

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

##### Publishing a Module

The publish flow validates locally, computes a SHA-256 hash for integrity, and uploads to the Hub.

```bash
# Publish a .dops file
dojops modules publish my-module.dops

# Publish with a changelog message
dojops modules publish my-module.dops --changelog "Added Docker support"

# Publish by module name (looks up in .dojops/modules/)
dojops modules publish my-module
```

**What happens during publish:**

1. **Local validation** — The `.dops` file is parsed and validated against the .dops spec (v1 or v2 — frontmatter, sections, Zod schemas)
2. **SHA-256 hash** — The CLI computes a SHA-256 hash of the file as a **publisher attestation**
3. **Upload** — The file and hash are sent to the Hub via `POST /api/packages` with `Authorization: Bearer <token>`
4. **Server verification** — The Hub recomputes the hash and compares it against the client-provided hash. Mismatches are rejected
5. **Storage** — The Hub stores the file and the publisher's hash for download integrity verification

**Example output:**

```
◇  Validated: my-tool v1.0.0
◇  SHA256: a1b2c3d4e5f6...
┌  Published new tool
│  Name:    my-tool
│  Version: v1.0.0
│  Slug:    my-tool
│  SHA256:  a1b2c3d4e5f6...
│  URL:     https://hub.dojops.ai/packages/my-tool
└
```

**Publishing a new version** of an existing module uses the same command — the Hub detects the existing package and adds the new version:

```bash
# Update version in .dops frontmatter, then:
dojops modules publish my-module.dops --changelog "v1.1.0: Added Redis support"
```

##### Installing a Module

The install flow downloads the module, verifies its integrity against the publisher's hash, and places it in your modules directory.

```bash
# Install latest version (project-local)
dojops modules install nginx-config

# Install a specific version
dojops modules install nginx-config --version 1.0.0

# Install globally (~/.dojops/modules/)
dojops modules install nginx-config --global
```

**What happens during install:**

1. **Fetch metadata** — The CLI queries `GET /api/packages/<slug>` to resolve the latest version (unless `--version` is specified)
2. **Download** — The `.dops` file is downloaded from `GET /api/download/<slug>/<version>` with the publisher's SHA-256 hash in the `X-Checksum-Sha256` response header
3. **Integrity check** — The CLI recomputes the SHA-256 hash locally and compares it against the publisher's hash. **Mismatches abort the install** with a tampering warning
4. **Validation** — The downloaded file is parsed and validated as a `.dops` module
5. **Write** — The file is saved to `.dojops/modules/<name>.dops` (project) or `~/.dojops/modules/<name>.dops` (global)

**Example output:**

```
◇  Downloading nginx-config v1.0.0...
┌  Tool installed
│  Name:    nginx-config
│  Version: v1.0.0
│  Path:    .dojops/modules/nginx-config.dops
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

### Module Policy

Control which custom modules are allowed via `.dojops/policy.yaml`:

```yaml
# Only allow specific tools
allowedTools:
  - my-tool
  - another-tool

# Block specific tools (takes precedence over allowedTools)
blockedTools:
  - untrusted-tool
```

### Module Isolation

Custom modules are sandboxed with the same guardrails as built-in modules, plus additional controls:

- **Verification command whitelist** — Only 16 known DevOps binaries are allowed (terraform, kubectl, helm, ansible-lint, docker, hadolint, yamllint, jsonlint, shellcheck, tflint, kubeval, conftest, checkov, trivy, kube-score, polaris). Non-whitelisted commands are rejected at runtime
- **Permission enforcement** — The `permissions.child_process` field must be `"required"` for verification commands to execute. Omitted or `"none"` means the command is silently skipped (default-safe)
- **Path traversal prevention** — File paths in `files[].path` and `detector.path` cannot contain `..` segments, preventing writes outside the project directory
- **Execution guardrails** — Custom tools execute through the same `SafeExecutor` pipeline as built-in tools, inheriting `maxFileSize` (1MB default), `timeoutMs` (30s default), DevOps write allowlist enforcement, and per-file audit logging

### Module Specification

The v1 custom module contract is documented and frozen in [Tool Specification v1](TOOL_SPEC_v1.md). This spec covers manifest schema, discovery paths, input/output schemas, verification command whitelist, security constraints, and the compatibility promise.

### Custom Module Audit Trail

Custom module executions include additional audit metadata:

- `toolType: "custom"` — distinguishes from built-in modules
- `toolSource: "global" | "project"` — where the custom module was discovered
- `toolVersion` — version from the manifest
- `toolHash` — SHA-256 hash of module directory for integrity verification
- `systemPromptHash` — SHA-256 hash of the custom module's system prompt for reproducibility tracking

### Supported Serializers

> **Note:** v2 tools output raw content directly from the LLM — serializers are not used. These serializers apply to v1 tools and custom `tool.yaml` tools.

| Serializer | Description                        |
| ---------- | ---------------------------------- |
| `yaml`     | YAML via js-yaml                   |
| `json`     | JSON via JSON.stringify (indented) |
| `raw`      | Passthrough string                 |
| `hcl`      | Falls back to raw (v1)             |
| `ini`      | Falls back to raw (v1)             |
| `toml`     | Falls back to raw (v1)             |
