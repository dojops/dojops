# DevOps Tools

DojOps includes 12 built-in DevOps tools covering CI/CD, infrastructure-as-code, containers, monitoring, and system services. All tools follow a consistent pattern built on the `BaseTool<T>` abstract class. Additionally, a **plugin system** lets you extend DojOps with custom tools via declarative `plugin.yaml` manifests.

---

## Tool Overview

| Tool           | Serialization      | Output Files                        | Detector | Verifier             |
| -------------- | ------------------ | ----------------------------------- | -------- | -------------------- |
| GitHub Actions | YAML               | `.github/workflows/ci.yml`          | Yes      | --                   |
| Terraform      | HCL                | `main.tf`, `variables.tf`           | Yes      | `terraform validate` |
| Kubernetes     | YAML               | K8s manifests                       | --       | `kubectl --dry-run`  |
| Helm           | YAML               | `Chart.yaml`, `values.yaml`         | --       | --                   |
| Ansible        | YAML               | `{name}.yml`                        | --       | --                   |
| Docker Compose | YAML               | `docker-compose.yml`                | Yes      | --                   |
| Dockerfile     | Dockerfile syntax  | `Dockerfile`, `.dockerignore`       | Yes      | `hadolint`           |
| Nginx          | Nginx conf         | `nginx.conf`                        | --       | --                   |
| Makefile       | Make syntax (tabs) | `Makefile`                          | Yes      | --                   |
| GitLab CI      | YAML               | `.gitlab-ci.yml`                    | Yes      | --                   |
| Prometheus     | YAML               | `prometheus.yml`, `alert-rules.yml` | --       | --                   |
| Systemd        | INI                | `{name}.service`                    | --       | --                   |

---

## Tool Pattern

Every tool follows the same file structure:

```
tool-name/
  schemas.ts      Zod input/output schemas (includes optional existingContent field)
  detector.ts     (optional) Filesystem detection of project context
  generator.ts    LLM call with structured schema -> serialization (YAML/HCL/custom)
                  Accepts optional existingContent param to switch between "generate new" and "update existing" prompts
  verifier.ts     (optional) External tool validation
  *-tool.ts       BaseTool subclass: generate() auto-detects existing files, verify() validates, execute() backs up + writes
  index.ts        Barrel exports
  *.test.ts       Vitest tests
```

### BaseTool Abstract Class

```typescript
abstract class BaseTool<TInput> {
  abstract name: string;
  abstract inputSchema: ZodSchema<TInput>;

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

### Schemas (`schemas.ts`)

Each tool defines Zod schemas for its input and output:

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

### Generator (`generator.ts`)

Calls the LLM with a structured Zod schema, parses the response, and serializes to the target format (YAML, HCL, Dockerfile syntax, INI, etc.).

All generators accept an optional `existingContent?: string` parameter. When provided:

- The **system prompt** switches from "Generate a new config" to "Update the existing config. Preserve existing structure and settings."
- The **user prompt** appends the existing content in a delimited block (`--- EXISTING CONFIGURATION ---`)
- This enables tools to enhance existing configs rather than replacing them from scratch

### Verifier (`verifier.ts`)

Optional external tool validation. Three tools implement verification:

| Tool       | External Binary | Verification Command       |
| ---------- | --------------- | -------------------------- |
| Terraform  | `terraform`     | `terraform validate`       |
| Dockerfile | `hadolint`      | `hadolint Dockerfile`      |
| Kubernetes | `kubectl`       | `kubectl --dry-run=client` |

Verification runs by default in CLI commands. Use `--skip-verify` to disable. Gracefully skips if the external binary is not installed.

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

## Plugin System

DojOps supports custom tools via the `@dojops/tool-registry` plugin system. Plugin tools are discovered automatically and behave exactly like built-in tools — they go through the same Planner, Executor, verification, and audit pipeline.

### Plugin Discovery

Plugins are discovered from two locations:

1. **Global:** `~/.dojops/plugins/<name>/plugin.yaml`
2. **Project:** `.dojops/plugins/<name>/plugin.yaml` (overrides global if same name)

Plugin discovery happens automatically on every command — no manual registration needed.

### Plugin Manifest (`plugin.yaml`)

Each plugin is a directory containing a `plugin.yaml` manifest and a JSON Schema file:

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

A JSON Schema file defining the plugin's input parameters:

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

### Plugin CLI Commands

```bash
# List all discovered plugins (global + project)
dojops tools plugins list

# Validate a plugin manifest
dojops tools plugins validate .dojops/plugins/my-tool/

# Scaffold a new plugin with template files
dojops tools plugins init my-tool
```

### Plugin Policy

Control which plugins are allowed via `.dojops/policy.yaml`:

```yaml
# Only allow specific plugins
allowedPlugins:
  - my-tool
  - another-tool

# Block specific plugins (takes precedence over allowedPlugins)
blockedPlugins:
  - untrusted-tool
```

### Plugin Isolation

Plugins are sandboxed with three security controls:

- **Verification command whitelist** — Only 16 known DevOps binaries are allowed (terraform, kubectl, helm, ansible-lint, docker, hadolint, yamllint, jsonlint, shellcheck, tflint, kubeval, conftest, checkov, trivy, kube-score, polaris). Non-whitelisted commands are rejected at runtime
- **Permission enforcement** — The `permissions.child_process` field must be `"required"` for verification commands to execute. Omitted or `"none"` means the command is silently skipped (default-safe)
- **Path traversal prevention** — File paths in `files[].path` and `detector.path` cannot contain `..` segments, preventing writes outside the project directory

### Plugin Specification

The v1 plugin contract is documented and frozen in [Plugin Specification v1](PLUGIN_SPEC_v1.md). This spec covers manifest schema, discovery paths, input/output schemas, verification command whitelist, security constraints, and the compatibility promise.

### Plugin Audit Trail

Plugin executions include additional audit metadata:

- `toolType: "plugin"` — distinguishes from built-in tools
- `pluginSource: "global" | "project"` — where the plugin was discovered
- `pluginVersion` — version from the manifest
- `pluginHash` — SHA-256 hash of plugin directory for integrity verification
- `systemPromptHash` — SHA-256 hash of the plugin's system prompt for reproducibility tracking

### Supported Serializers

| Serializer | Description                        |
| ---------- | ---------------------------------- |
| `yaml`     | YAML via js-yaml                   |
| `json`     | JSON via JSON.stringify (indented) |
| `raw`      | Passthrough string                 |
| `hcl`      | Falls back to raw (v1)             |
| `ini`      | Falls back to raw (v1)             |
| `toml`     | Falls back to raw (v1)             |
