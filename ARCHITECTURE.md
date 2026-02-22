# ODA Architecture

## Overview

ODA is designed as a modular, layered DevOps agent system.

It is NOT a simple chatbot that generates bash commands.

It is a structured, safe, extensible orchestration framework with 12 DevOps tools, 16 specialist agents, sandboxed execution, approval workflows, and hash-chained audit trails.

---

## High-Level Architecture

```
User
 ↓
CLI (@clack/prompts TUI) / REST API (Express)
 ↓
Agent Router (16 specialist agents, keyword confidence scoring)
 ↓
Planner Engine (LLM → TaskGraph → topological execution)
 ↓
Tool SDK Layer (12 DevOps tools, Zod validation)
 ↓
Execution Engine (Sandboxed, policy-enforced, approval-gated, audit-logged)
```

---

## Package Architecture

```
@odaops/cli          CLI entry point + rich TUI (@clack/prompts)
@odaops/api          REST API (Express) + web dashboard
@odaops/planner      TaskGraph decomposition + topological executor
@odaops/executor     SafeExecutor: sandbox + policy engine + approval + audit log
@odaops/tools        12 DevOps tools (GitHub Actions, Terraform, K8s, Helm, Ansible,
                     Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd)
@odaops/core         LLM abstraction + 16 specialist agents + CI debugger + infra diff
@odaops/sdk          BaseTool<T> abstract class with Zod validation + optional verify()
```

**Dependency flow** (top → bottom):

```
@odaops/cli
  └─ @odaops/api
       ├─ @odaops/planner
       │    └─ @odaops/core
       │         └─ @odaops/sdk (zod)
       ├─ @odaops/executor
       │    └─ @odaops/sdk
       └─ @odaops/tools
            ├─ @odaops/core
            └─ @odaops/sdk
```

---

## Core Layers

### 1. LLM Layer (`@odaops/core`)

Provides abstraction over five providers:

- **OpenAI** — `response_format: { type: "json_object" }` for structured output
- **Anthropic** — JSON prefill technique for structured output
- **Ollama** — `format: "json"` for local model structured output
- **DeepSeek** — OpenAI-compatible API with custom `baseURL` (reuses `openai` package)
- **Gemini** — `responseMimeType: "application/json"` via `@google/genai` SDK

Each provider implements:

```typescript
interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  listModels?(): Promise<string[]>;
}
```

The optional `listModels()` method fetches available models from the provider's API, used by `oda config` for dynamic model selection.

All responses pass through `parseAndValidate()` — strips markdown fences, `JSON.parse`, Zod `safeParse` — ensuring every LLM output conforms to the expected schema.

---

### 2. Multi-Agent System (`@odaops/core`)

16 specialist agents with keyword-based routing and confidence scoring:

| Agent                    | Domain                  | Key Capabilities                              |
| ------------------------ | ----------------------- | --------------------------------------------- |
| ops-cortex               | orchestration           | Plan decomposition, strategy, roadmap         |
| terraform-specialist     | infrastructure          | Terraform, HCL, provisioning, modules         |
| kubernetes-specialist    | container-orchestration | K8s, pods, deployments, Helm, ingress         |
| cicd-specialist          | ci-cd                   | Pipelines, GitHub Actions, Jenkins, GitLab CI |
| security-auditor         | security                | Vulnerability audit, secrets, firewall, IAM   |
| observability-specialist | observability           | Monitoring, logging, alerting, Prometheus     |
| docker-specialist        | containerization        | Dockerfile, images, compose, containers       |
| cloud-architect          | cloud-architecture      | AWS, GCP, Azure, serverless, migration        |
| network-specialist       | networking              | DNS, load balancers, VPC, VPN, CDN, Nginx     |
| database-specialist      | data-storage            | Postgres, MySQL, Redis, DynamoDB              |
| gitops-specialist        | gitops                  | ArgoCD, Flux, reconciliation, drift           |
| compliance-auditor       | compliance              | SOC2, HIPAA, policy, OPA                      |
| ci-debugger              | ci-debugging            | Error analysis, root cause, fix suggestions   |
| appsec-specialist        | application-security    | OWASP, XSS, injection, SAST, DAST             |
| shell-specialist         | shell-scripting         | Bash, ShellCheck, POSIX, cron                 |
| python-specialist        | python-scripting        | Python, pip, pytest, mypy, Poetry             |

The `AgentRouter` scores prompts against each agent's keyword list and routes to the highest-confidence match. If no agent exceeds the threshold, it falls back to the general-purpose `DevOpsAgent`.

---

### 3. Planner Engine (`@odaops/planner`)

Transforms user intent into structured, dependency-aware task graphs.

```
User Input: "Create CI/CD pipeline for Node.js app"
     ↓
LLM Decomposition (decompose())
     ↓
TaskGraph {
  nodes: [
    { id: "1", tool: "github-actions", input: {...}, deps: [] },
    { id: "2", tool: "dockerfile",     input: {...}, deps: ["1"] },
    { id: "3", tool: "kubernetes",     input: {...}, deps: ["2"] }
  ]
}
     ↓
Topological Execution (Kahn's algorithm)
     ↓
Per-task results with $ref:<taskId> input wiring
```

Features:

- LLM-powered goal decomposition into `TaskGraph` with Zod schema validation
- Topological sort via Kahn's algorithm for dependency-respecting execution order
- `$ref:<taskId>` input wiring passes outputs between dependent tasks
- `completedTaskIds` tracking enables resume after partial failures
- Failure cascading skips downstream tasks when a dependency fails

---

### 4. Tool SDK (`@odaops/sdk`)

Abstract base class for all DevOps tools:

```typescript
abstract class BaseTool<TInput> {
  abstract name: string;
  abstract inputSchema: ZodSchema<TInput>;
  validate(input: unknown): TInput; // Zod validation
  abstract generate(input: TInput): Promise<Result>; // LLM generation
  execute?(input: TInput): Promise<void>; // Optional: write to disk
  verify?(data: unknown): Promise<VerificationResult>; // Optional: validate generated output
}
```

Tools that implement `verify()` can validate their generated output with external tools (e.g. `terraform validate`, `hadolint`, `kubectl --dry-run=client`) before files are written. Verification is opt-in via `--verify` and gracefully skips if the external binary is not found.

---

### 5. DevOps Tools (`@odaops/tools`)

12 tools covering CI/CD, IaC, containers, monitoring, and system services:

| Tool           | Directory         | Detector | Verifier             | Serialization                | Output Files                        |
| -------------- | ----------------- | -------- | -------------------- | ---------------------------- | ----------------------------------- |
| GitHub Actions | `github/`         | Yes      | —                    | js-yaml                      | `.github/workflows/ci.yml`          |
| Terraform      | `terraform/`      | Yes      | `terraform validate` | Custom HCL builder           | `main.tf`, `variables.tf`           |
| Kubernetes     | `kubernetes/`     | No       | `kubectl --dry-run`  | js-yaml                      | K8s manifests                       |
| Helm           | `helm/`           | No       | —                    | js-yaml                      | `Chart.yaml`, `values.yaml`         |
| Ansible        | `ansible/`        | No       | —                    | js-yaml                      | `{name}.yml`                        |
| Docker Compose | `docker-compose/` | Yes      | —                    | js-yaml                      | `docker-compose.yml`                |
| Dockerfile     | `dockerfile/`     | Yes      | `hadolint`           | Custom string builder        | `Dockerfile`, `.dockerignore`       |
| Nginx          | `nginx/`          | No       | —                    | Custom string builder        | `nginx.conf`                        |
| Makefile       | `makefile/`       | Yes      | —                    | Custom string builder (tabs) | `Makefile`                          |
| GitLab CI      | `gitlab-ci/`      | Yes      | —                    | js-yaml                      | `.gitlab-ci.yml`                    |
| Prometheus     | `prometheus/`     | No       | —                    | js-yaml                      | `prometheus.yml`, `alert-rules.yml` |
| Systemd        | `systemd/`        | No       | —                    | Custom string builder (INI)  | `{name}.service`                    |

All tools follow the same file pattern:

```
schemas.ts     → Zod input/output schemas
detector.ts    → (optional) filesystem detection of project context
generator.ts   → LLM call with structured schema → serialization (YAML/HCL/custom)
verifier.ts    → (optional) external tool validation (terraform validate, hadolint, kubectl)
*-tool.ts      → BaseTool subclass: generate() returns data, verify() validates, execute() writes
index.ts       → barrel exports
*.test.ts      → Vitest tests
```

---

### 6. Execution Engine (`@odaops/executor`)

Responsible for safe, auditable execution of generated configs:

- **SafeExecutor** — orchestrates generate → **verify** → approval → execute pipeline
- **Verification step** — after generate succeeds, calls `tool.verify(data)` if the tool implements it and `skipVerification` is false. Failed verification blocks execution. Missing external binaries gracefully skip with a warning
- **ExecutionPolicy** — controls write permissions, allowed/denied paths, env vars, timeouts, file size limits, and `skipVerification` toggle (default: true, opt-in via `--verify`)
- **ApprovalHandler** — interface with three implementations: `AutoApproveHandler`, `AutoDenyHandler`, `CallbackApprovalHandler`
- **SandboxedFs** — path-restricted file operations with per-file audit logging
- **AuditEntry** — structured audit records for every operation, including verification results
- **withTimeout()** — execution time limits

---

### 7. CLI (`@odaops/cli`)

Full-lifecycle CLI with rich TUI powered by `@clack/prompts`:

```
oda "prompt"           → Agent-routed generation (default command)
oda plan "goal"        → LLM task decomposition
oda validate           → Schema validation of saved plan
oda apply              → Execute plan with approval workflow
oda apply --verify     → Execute with external config verification
oda apply --resume     → Resume partially-failed plan
oda apply --dry-run    → Preview without executing
oda destroy            → Remove generated artifacts
oda rollback           → Reverse an applied plan
oda explain            → LLM explains a plan
oda debug ci "log"     → CI log diagnosis
oda analyze diff "diff"→ Infrastructure diff analysis
oda agents             → List/inspect specialist agents
oda inspect            → Inspect config, policy, agents, session
oda history            → View execution history
oda history verify     → Verify audit log hash chain
oda config             → Configure provider, model, tokens
oda auth               → Authenticate with LLM provider
oda serve              → Start REST API + web dashboard
oda doctor             → System health diagnostics
oda init               → Initialize .oda/ project state
```

TUI features: interactive arrow-key prompts, spinners for async ops, styled note panels, semantic log levels, session framing with intro/outro.

---

### 8. REST API & Dashboard (`@odaops/api`)

Express-based API with dependency injection via `createApp(deps)`:

| Method | Path                    | Description                                          |
| ------ | ----------------------- | ---------------------------------------------------- |
| GET    | `/api/health`           | Provider info, tool list, metricsEnabled flag        |
| POST   | `/api/generate`         | Agent-routed LLM generation                          |
| POST   | `/api/plan`             | Decompose goal into task graph                       |
| POST   | `/api/debug-ci`         | Diagnose CI log failures                             |
| POST   | `/api/diff`             | Analyze infrastructure diff                          |
| GET    | `/api/agents`           | List specialist agents                               |
| GET    | `/api/history`          | Execution history                                    |
| GET    | `/api/history/:id`      | Single history entry                                 |
| DELETE | `/api/history`          | Clear history                                        |
| GET    | `/api/metrics`          | Full dashboard metrics (overview + security + audit) |
| GET    | `/api/metrics/overview` | Plan/execution/scan aggregates                       |
| GET    | `/api/metrics/security` | Scan findings, severity trends, top issues           |
| GET    | `/api/metrics/audit`    | Audit chain integrity, command distribution          |

Web dashboard: dark-themed SPA with 9 tabs (Generate, Plan, Debug CI, Infra Diff, Agents, History, Overview, Security, Audit).

### 9. Metrics Aggregation (`@odaops/api`)

`MetricsAggregator` reads `.oda/` project data on-demand and computes dashboard metrics:

- **OverviewMetrics** — total plans, executions, success rate, avg execution time, scan findings (critical/high), most used commands, failure reasons, recent activity timeline
- **SecurityMetrics** — total scans, severity breakdown (critical/high/medium/low), category breakdown (security/dependency/iac/secrets), findings trend (grouped by date), top recurring issues, scan history
- **AuditMetrics** — total entries, hash-chain integrity verification (recomputes SHA-256 hashes), status breakdown (success/failure/cancelled), command distribution, timeline

Data sources: `.oda/plans/*.json`, `.oda/execution-logs/*.json`, `.oda/scan-history/*.json`, `.oda/history/audit.jsonl`.

Enabled when `rootDir` is passed to `createApp()` (the CLI `serve` command auto-detects via `findProjectRoot()`). Gracefully returns empty/zero values when no `.oda/` data exists.

---

## Security Architecture

ODA implements defense-in-depth with seven layers between LLM output and infrastructure changes:

```
  LLM Response
       │
  ┌────▼────┐
  │Structured│  Provider-native JSON mode (OpenAI response_format,
  │ Output   │  Anthropic prefill, Ollama format)
  └────┬─────┘
       │
  ┌────▼────┐
  │  Input   │  Zod schema validation on every tool input
  │Validation│  and LLM response (parseAndValidate)
  └────┬─────┘
       │
  ┌────▼─────┐
  │  Deep     │  Optional external tool verification (--verify):
  │Verification│  terraform validate, hadolint, kubectl dry-run
  └────┬──────┘
       │
  ┌────▼────┐
  │ Policy   │  ExecutionPolicy: allowWrite, allowedPaths,
  │ Engine   │  deniedPaths, envVars, timeoutMs, maxFileSize
  └────┬─────┘
       │
  ┌────▼────┐
  │Approval  │  ApprovalHandler: auto-approve, auto-deny,
  │Workflow  │  or interactive callback with diff preview
  └────┬─────┘
       │
  ┌────▼────┐
  │Sandboxed │  SandboxedFs: path-restricted file operations
  │Execution │  with per-file audit logging
  └────┬─────┘
       │
  ┌────▼────┐
  │Immutable │  Hash-chained JSONL audit trail (SHA-256)
  │Audit Log │  with tamper detection via `oda history verify`
  └──────────┘
```

**Trust boundary**: LLM output is untrusted. All data crosses the trust boundary at the Structured Output layer and is validated at every subsequent layer before any write operation occurs.

**Concurrency safety**: PID-based execution locking (`lock.json`) prevents concurrent apply/destroy/rollback operations, with automatic stale-lock cleanup for dead processes.

---

## Design Principles

1. **No blind execution** — Every LLM output is validated before use.
2. **Structured JSON outputs** — Provider-native JSON modes + Zod schemas on all LLM responses.
3. **Schema validation everywhere** — Tool inputs, LLM responses, plan structures, API requests.
4. **Idempotent operations** — Generated configs produce the same result on re-execution.
5. **Clear separation of concerns** — Orchestration, generation, validation, execution, and auditing are independent layers.
6. **Extensibility** — New tools follow the `BaseTool<T>` pattern. New agents are registered in the specialist list.

---

## Test Coverage

637 tests across all packages:

| Package            | Tests   |
| ------------------ | ------- |
| `@odaops/core`     | 155     |
| `@odaops/cli`      | 144     |
| `@odaops/tools`    | 111     |
| `@odaops/api`      | 95      |
| `@odaops/executor` | 40      |
| `@odaops/scanner`  | 29      |
| `@odaops/planner`  | 28      |
| `@odaops/session`  | 28      |
| `@odaops/sdk`      | 7       |
| **Total**          | **637** |
