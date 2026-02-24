# DevOps Tools

DojOps includes 12 DevOps tools covering CI/CD, infrastructure-as-code, containers, monitoring, and system services. All tools follow a consistent pattern built on the `BaseTool<T>` abstract class.

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
  schemas.ts      Zod input/output schemas
  detector.ts     (optional) Filesystem detection of project context
  generator.ts    LLM call with structured schema -> serialization (YAML/HCL/custom)
  verifier.ts     (optional) External tool validation
  *-tool.ts       BaseTool subclass: generate(), verify(), execute()
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

- **Input schema** — Validates user/planner input before generation
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

### Verifier (`verifier.ts`)

Optional external tool validation. Three tools implement verification:

| Tool       | External Binary | Verification Command       |
| ---------- | --------------- | -------------------------- |
| Terraform  | `terraform`     | `terraform validate`       |
| Dockerfile | `hadolint`      | `hadolint Dockerfile`      |
| Kubernetes | `kubectl`       | `kubectl --dry-run=client` |

Verification is opt-in via `--verify` and gracefully skips if the external binary is not installed.

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
     /* ... */
   });
   export const MyToolOutputSchema = z.object({
     /* ... */
   });
   ```

3. **Implement the generator** (`generator.ts`):

   ```typescript
   export async function generateMyTool(input, provider) {
     const response = await provider.generate({
       prompt: buildPrompt(input),
       schema: MyToolOutputSchema,
     });
     return parseAndValidate(response.content, MyToolOutputSchema);
   }
   ```

4. **Create the tool class** (`my-tool.ts`):

   ```typescript
   import { BaseTool } from "@dojops/sdk";
   export class MyTool extends BaseTool<MyToolInput> {
     name = "my-tool";
     inputSchema = MyToolInputSchema;
     async generate(input) {
       /* ... */
     }
     async execute(input) {
       /* ... */
     }
   }
   ```

5. **Add optional detector** (`detector.ts`) and **verifier** (`verifier.ts`).

6. **Export from index** (`index.ts`) and add to the tools barrel export in `packages/tools/src/index.ts`.

7. **Write tests** (`my-tool.test.ts`).
