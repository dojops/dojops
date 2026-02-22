<p align="center">
  <img src=".oda/oda-icon.png" alt="ODA" width="120" />
</p>

<h1 align="center">ODA — Open DevOps Agent</h1>

<p align="center">
  <strong>Enterprise-grade AI DevOps automation.</strong><br />
  Generate, validate, and execute infrastructure &amp; CI/CD configurations safely — with structured output enforcement, sandboxed execution, approval workflows, and hash-chained audit trails.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;·&nbsp;
  <a href="#features">Features</a> &nbsp;·&nbsp;
  <a href="#web-dashboard">Dashboard</a> &nbsp;·&nbsp;
  <a href="#cli-reference">CLI Reference</a> &nbsp;·&nbsp;
  <a href="#api-reference">API Reference</a> &nbsp;·&nbsp;
  <a href="#architecture">Architecture</a> &nbsp;·&nbsp;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-00e5ff?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/typescript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/tests-555%20passed-22c55e?style=flat-square" alt="Tests" />
  <img src="https://img.shields.io/badge/tools-12-eab308?style=flat-square" alt="Tools" />
  <img src="https://img.shields.io/badge/agents-16-8b5cf6?style=flat-square" alt="Agents" />
  <img src="https://img.shields.io/badge/providers-5-ef4444?style=flat-square" alt="Providers" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

---

## The Problem

1. **Manual IaC is slow** — Writing Terraform, Kubernetes, and CI/CD configs from scratch takes hours. Teams spend more time on boilerplate than architecture.
2. **AI-generated configs are unsafe** — LLMs produce plausible but unvalidated output. Without schema enforcement and execution controls, AI-generated infrastructure is a liability.
3. **Teams lack visibility into AI-driven changes** — When AI generates configs, there's no audit trail, no approval gate, and no way to resume partial failures. Compliance teams can't sign off on what they can't verify.

---

## Quick Start

```bash
# 1. Install globally
npm i -g @odaops/cli

# 2. Configure your provider (interactive wizard)
oda config

# 3. Generate your first config
oda "Create a Kubernetes deployment for nginx with 3 replicas"
```

Or set environment variables directly:

```bash
export ODA_PROVIDER=openai          # openai | anthropic | ollama | deepseek | gemini
export OPENAI_API_KEY=sk-...        # your API key
oda "Create a Terraform config for S3 with versioning"
```

---

## How ODA Works

### Simple Mode — Stateless CLI

```bash
oda "Create a Terraform config for S3 with versioning"
oda "Create a Dockerfile for a Node.js Express app"
oda debug ci "ERROR: tsc failed with exit code 1..."
oda analyze diff "terraform plan output..."
```

ODA routes to the right specialist agent, enforces structured JSON output via Zod schemas, and returns validated configs.

### Enterprise Mode — Full Lifecycle

```bash
oda init                              # Initialize project state
oda plan "Create CI/CD for Node app"  # Decompose into task graph
oda validate                          # Validate plan against schemas
oda apply                             # Execute with approval workflow
oda apply --resume                    # Resume partially-failed plans
oda history verify                    # Verify audit log integrity
oda history show <plan-id>            # Inspect per-task results
```

Plans are persisted, execution is sandboxed, every action is audit-logged with hash-chained integrity, and partial failures can be resumed without re-executing completed tasks.

### Web Dashboard

```bash
oda serve                             # Start at http://localhost:3000
oda serve --port=8080                 # Custom port
```

The dashboard provides a visual interface with dark industrial terminal aesthetic for all ODA capabilities — generate configs, decompose plans, debug CI logs, analyze infra diffs, browse agents, and review execution history.

---

## Features

### Intelligence

- **16 specialist agents** — ops-cortex, terraform, kubernetes, CI/CD, security, Docker, cloud architecture, networking, database, GitOps, compliance, CI debugger, appsec, shell scripting, Python, and observability — with weighted keyword confidence scoring
- **CI debugging** — Paste CI logs, get structured diagnosis with error type, root cause, affected files, and suggested fixes with confidence scores
- **Infra diff analysis** — Risk level, cost impact, security implications, rollback complexity, and actionable recommendations for infrastructure changes
- **5 LLM providers** — OpenAI, Anthropic, Ollama (local), DeepSeek, Google Gemini — with dynamic model selection via provider API

### Tools

- **12 DevOps tools** — GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd
- **Schema-validated** — Every tool input and LLM output is validated against Zod schemas before execution
- **Deep verification** — Optional `--verify` runs generated configs through external validators (terraform validate, hadolint, kubectl dry-run) before writing files
- **Structured output** — Provider-native JSON modes (OpenAI `response_format`, Anthropic prefill, Ollama `format`, Gemini `responseMimeType`)

### Execution

- **Task planner** — LLM-powered goal decomposition into dependency-aware task graphs with topological execution (Kahn's algorithm)
- **Verification pipeline** — Optional `verify()` step between generate and execute validates output with external tools (terraform validate, hadolint, kubectl --dry-run=client). Graceful fallback when tools are missing
- **Sandboxed execution** — `SandboxedFs` restricts file operations to policy-allowed paths
- **Policy engine** — `ExecutionPolicy` controls write permissions, allowed/denied paths, environment variables, timeouts, file size limits, and verification toggle
- **Approval workflows** — Auto-approve, auto-deny, or interactive callback with diff preview before any write operation
- **Resume on failure** — `oda apply --resume` skips completed tasks and retries failed ones

### Observability

- **Hash-chained audit logs** — Tamper-evident JSONL audit trail with SHA-256 chain integrity verification via `oda history verify`
- **Execution locking** — PID-based lock files prevent concurrent mutations with automatic stale-lock cleanup
- **Rich terminal UI** — Interactive prompts, spinners, styled panels, semantic log levels — powered by `@clack/prompts`

### Platform

- **REST API** — 9 endpoints exposing all capabilities over HTTP with Zod request validation
- **Web dashboard** — Single-page app with dark terminal aesthetic, toast notifications, copy-to-clipboard, responsive layout
- **Configuration profiles** — Named profiles for switching between providers/environments

---

## Architecture

```
@odaops/cli          CLI entry point + rich TUI (@clack/prompts)
@odaops/api          REST API (Express) + web dashboard + factory functions
@odaops/planner      TaskGraph decomposition + topological executor
@odaops/executor     SafeExecutor: sandbox + policy engine + approval + audit log
@odaops/tools        12 DevOps tools (GitHub Actions, Terraform, K8s, Helm, Ansible,
                     Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd)
@odaops/core         LLM abstraction + 5 providers + 16 specialist agents + CI debugger + infra diff
@odaops/sdk          BaseTool<T> abstract class with Zod validation + optional verify()
```

### Package Dependency Flow

```
cli → api → planner → executor → tools → core → sdk
```

Full architecture details in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## CLI Reference

### Commands

| Command                       | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `oda <prompt>`                | Generate DevOps config (default command)        |
| `oda plan <prompt>`           | Decompose goal into dependency-aware task graph |
| `oda plan --execute <prompt>` | Plan + execute with approval workflow           |
| `oda apply`                   | Execute a saved plan                            |
| `oda apply --verify`          | Execute with external config verification       |
| `oda apply --resume`          | Resume a partially-failed plan                  |
| `oda validate`                | Validate plan against schemas                   |
| `oda explain`                 | LLM explains a plan in plain language           |
| `oda debug ci <log>`          | Diagnose CI/CD log failures                     |
| `oda analyze diff <diff>`     | Analyze infrastructure diff for risk            |
| `oda inspect <target>`        | Inspect config, policy, agents, session         |
| `oda agents list`             | List specialist agents                          |
| `oda agents info <name>`      | Show agent details                              |
| `oda history list`            | View execution history                          |
| `oda history show <id>`       | Show plan details and results                   |
| `oda history verify`          | Verify audit log hash chain integrity           |
| `oda config`                  | Configure provider, model, tokens (interactive) |
| `oda auth login`              | Authenticate with LLM provider                  |
| `oda serve`                   | Start API server + web dashboard                |
| `oda doctor`                  | System health diagnostics                       |
| `oda init`                    | Initialize `.oda/` project directory            |
| `oda destroy <plan-id>`       | Remove generated artifacts from a plan          |
| `oda rollback <plan-id>`      | Reverse an applied plan                         |

### Global Options

| Option              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `--provider=NAME`   | LLM provider: `openai`, `anthropic`, `ollama`, `deepseek`, `gemini` |
| `--model=NAME`      | LLM model override                                                  |
| `--profile=NAME`    | Use named config profile                                            |
| `--output=FORMAT`   | Output: `table` (default), `json`, `yaml`                           |
| `--verbose`         | Verbose output                                                      |
| `--debug`           | Debug-level output                                                  |
| `--quiet`           | Suppress non-essential output                                       |
| `--no-color`        | Disable color output                                                |
| `--non-interactive` | Disable interactive prompts                                         |
| `--help, -h`        | Show help message                                                   |

### Examples

```bash
# Generate configs
oda "Create a Terraform config for S3"
oda "Write a Kubernetes deployment for nginx"
oda "Set up monitoring with Prometheus"

# Plan and execute
oda plan "Set up CI/CD for a Node.js app"
oda plan --execute --yes "Create CI for Node app"
oda apply --verify
oda apply --dry-run
oda apply --resume --yes

# Diagnose and analyze
oda debug ci "ERROR: tsc failed with exit code 1..."
oda analyze diff "terraform plan output..."
oda explain last

# Administration
oda doctor
oda agents list
oda history list
oda history verify
oda serve --port=8080
oda config profile create staging
```

---

## Security & Compliance

ODA implements defense-in-depth for AI-driven infrastructure changes:

| Layer                   | Mechanism                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Output enforcement**  | All LLM responses constrained to JSON schemas via provider-native modes                                             |
| **Schema validation**   | Every tool input and LLM output validated against Zod schemas before execution                                      |
| **Deep verification**   | Optional external tool validation: `terraform validate`, `hadolint`, `kubectl --dry-run=client` — before file write |
| **Policy engine**       | `ExecutionPolicy` controls write permissions, allowed/denied paths, env vars, timeouts, file size limits            |
| **Approval workflows**  | Configurable handlers: auto-approve, auto-deny, or interactive callback with diff preview                           |
| **Sandboxed execution** | `SandboxedFs` restricts file operations to policy-allowed paths with audit logging                                  |
| **Audit trail**         | Append-only JSONL with SHA-256 hash chaining (seq + previousHash + hash). Tamper detection via `oda history verify` |
| **Execution locking**   | PID-based lock files prevent concurrent mutations with automatic stale-lock cleanup                                 |

---

## Tools

| Tool           | Serialization      | Output Files                        | Verifier             |
| -------------- | ------------------ | ----------------------------------- | -------------------- |
| GitHub Actions | YAML               | `.github/workflows/ci.yml`          | —                    |
| Terraform      | HCL                | `main.tf`, `variables.tf`           | `terraform validate` |
| Kubernetes     | YAML               | K8s manifests                       | `kubectl --dry-run`  |
| Helm           | YAML               | `Chart.yaml`, `values.yaml`         | —                    |
| Ansible        | YAML               | `{name}.yml`                        | —                    |
| Docker Compose | YAML               | `docker-compose.yml`                | —                    |
| Dockerfile     | Dockerfile syntax  | `Dockerfile`, `.dockerignore`       | `hadolint`           |
| Nginx          | Nginx conf         | `nginx.conf`                        | —                    |
| Makefile       | Make syntax (tabs) | `Makefile`                          | —                    |
| GitLab CI      | YAML               | `.gitlab-ci.yml`                    | —                    |
| Prometheus     | YAML               | `prometheus.yml`, `alert-rules.yml` | —                    |
| Systemd        | INI                | `{name}.service`                    | —                    |

All tools follow the `BaseTool<T>` pattern: `schemas.ts` → `detector.ts` (optional) → `generator.ts` → `verifier.ts` (optional) → `*-tool.ts` → tests.

---

## Specialist Agents

| Agent                    | Domain                  | Key Capabilities                                                    |
| ------------------------ | ----------------------- | ------------------------------------------------------------------- |
| ops-cortex               | Orchestration           | Task decomposition, cross-domain routing, dependency ordering       |
| terraform-specialist     | Infrastructure          | HCL, modules, state management, workspaces, cost optimization       |
| kubernetes-specialist    | Container orchestration | Deployments, Helm, RBAC, autoscaling, service mesh                  |
| cicd-specialist          | CI/CD                   | GitHub Actions, GitLab CI, Jenkins, build optimization, pipelines   |
| security-auditor         | Security                | Vulnerability scanning, secret management, IAM, threat modeling     |
| observability-specialist | Observability           | Prometheus, Grafana, Datadog, tracing, SLOs, alerting               |
| docker-specialist        | Containerization        | Multi-stage builds, image optimization, registries, BuildKit        |
| cloud-architect          | Cloud architecture      | AWS/GCP/Azure design, cost optimization, migration strategies       |
| network-specialist       | Networking              | DNS, load balancers, VPN, CDN, service mesh, firewall rules         |
| database-specialist      | Data storage            | PostgreSQL, MySQL, Redis, DynamoDB, replication, backup             |
| gitops-specialist        | GitOps                  | ArgoCD, Flux, drift detection, sealed secrets, progressive delivery |
| compliance-auditor       | Compliance              | SOC2, HIPAA, PCI-DSS, GDPR, policy-as-code (OPA/Rego)               |
| ci-debugger              | CI debugging            | Log analysis, root cause diagnosis, flaky test detection            |
| appsec-specialist        | Application security    | OWASP Top 10, SAST/DAST, code review, pentest methodology           |
| shell-specialist         | Shell scripting         | Bash/POSIX, ShellCheck, error handling, automation                  |
| python-specialist        | Python scripting        | Type hints, pytest, poetry, async, CLI tools                        |

---

## API Reference

### Endpoints

| Method   | Path               | Description                      |
| -------- | ------------------ | -------------------------------- |
| `GET`    | `/api/health`      | Provider info, tool list, status |
| `POST`   | `/api/generate`    | Agent-routed LLM generation      |
| `POST`   | `/api/plan`        | Decompose goal into task graph   |
| `POST`   | `/api/debug-ci`    | Diagnose CI log failures         |
| `POST`   | `/api/diff`        | Analyze infrastructure diff      |
| `GET`    | `/api/agents`      | List specialist agents           |
| `GET`    | `/api/history`     | Execution history                |
| `GET`    | `/api/history/:id` | Single history entry             |
| `DELETE` | `/api/history`     | Clear history                    |

### Examples

```bash
# Generate a config
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a Kubernetes deployment for nginx", "temperature": 0.7}'

# Decompose a plan
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"goal": "Set up CI/CD for a Node.js app", "execute": false}'

# Debug CI logs
curl -X POST http://localhost:3000/api/debug-ci \
  -H "Content-Type: application/json" \
  -d '{"log": "ERROR: npm ERR! ERESOLVE unable to resolve dependency tree"}'

# Analyze infrastructure diff
curl -X POST http://localhost:3000/api/diff \
  -H "Content-Type: application/json" \
  -d '{"diff": "+ resource \"aws_s3_bucket\" \"main\" { bucket = \"my-bucket\" }"}'
```

---

## Configuration

### Supported Providers

| Provider  | `ODA_PROVIDER` | Required Env Var    | Default Model                |
| --------- | -------------- | ------------------- | ---------------------------- |
| OpenAI    | `openai`       | `OPENAI_API_KEY`    | `gpt-4o-mini`                |
| Anthropic | `anthropic`    | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` |
| Ollama    | `ollama`       | _(none — local)_    | `llama3`                     |
| DeepSeek  | `deepseek`     | `DEEPSEEK_API_KEY`  | `deepseek-chat`              |
| Gemini    | `gemini`       | `GEMINI_API_KEY`    | `gemini-2.5-flash`           |

### Model Selection

Each provider ships with a sensible default, but you can choose any model your provider supports:

```bash
oda config                          # Interactive: fetches models, shows picker
oda config --model=gpt-4o           # Set directly
oda --model=deepseek-reasoner "..." # One-off override
```

### Configuration Precedence

```
Provider:  --provider  >  $ODA_PROVIDER  >  config  >  openai
Model:     --model     >  $ODA_MODEL     >  config  >  provider default
Token:     $OPENAI_API_KEY / $ANTHROPIC_API_KEY / ...  >  config token
```

### Profiles

```bash
oda config profile create staging     # Save current config as "staging"
oda config profile use staging        # Switch to staging profile
oda config profile list               # List all profiles
oda --profile=staging "Create S3..."  # One-off profile override
```

---

## Development

### Prerequisites

- **Node.js** >= 18
- **pnpm** >= 8
- **TypeScript** >= 5.4

### Setup

```bash
git clone https://github.com/oda-devops/oda.git
cd oda
pnpm install
pnpm build
```

### Commands

```bash
pnpm build              # Build all packages via Turbo
pnpm dev                # Dev mode (no caching)
pnpm test               # Run all 555 tests
pnpm lint               # ESLint across all packages
pnpm format             # Prettier write
pnpm format:check       # Prettier check (CI)

# Per-package
pnpm --filter @odaops/core test
pnpm --filter @odaops/api build
pnpm --filter @odaops/tools lint

# Run locally (no global install)
pnpm oda -- "Create a Terraform config for S3"
pnpm oda -- serve --port=8080
```

### Project Structure

```
packages/
  cli/            CLI entry point + TUI (@clack/prompts)
  api/            REST API (Express) + web dashboard
  core/           LLM providers (5) + specialist agents (16) + CI debugger + infra diff
  planner/        Task graph decomposition + topological executor
  executor/       SafeExecutor + policy engine + approval workflows + audit log
  tools/          12 DevOps tools
  sdk/            BaseTool<T> abstract class + Zod re-export + verification types
```

### Test Coverage

| Package            | Tests   |
| ------------------ | ------- |
| `@odaops/core`     | 155     |
| `@odaops/cli`      | 144     |
| `@odaops/tools`    | 111     |
| `@odaops/api`      | 70      |
| `@odaops/executor` | 40      |
| `@odaops/planner`  | 28      |
| `@odaops/sdk`      | 7       |
| **Total**          | **555** |

---

## Publishing

All packages are published under the `@odaops` scope:

```bash
npm login
pnpm publish-packages    # Build + publish in dependency order
```

Publish order: `sdk` → `core` → `executor` → `planner` → `tools` → `api` → `cli`

---

## Roadmap

### v1.0.0 (current)

- Core intelligence — Structured output, Zod validation, planner engine
- 12 DevOps tools — CI/CD, IaC, containers, monitoring, system services
- Sandboxed execution — Policy engine, approval workflows, resume/recovery
- Multi-agent system — 16 specialist agents, CI debugging, infra diff analysis
- Platform — REST API (9 endpoints), web dashboard
- CLI TUI — Rich terminal UI with `@clack/prompts`
- Enterprise foundations — Hash-chained audit logs, execution locking, config profiles

### v2.0.0 (planned)

- RBAC & multi-tenancy
- Persistent storage backends (SQLite, PostgreSQL)
- OpenTelemetry observability
- SSO, webhooks, Slack/Teams integrations
- Git provider integration (auto-PR)
- Plugin system for custom tools and agents

See [NEXT_STEPS.md](NEXT_STEPS.md) for the full roadmap.

---

## Contributing

Contributions are welcome! Please see the [architecture docs](ARCHITECTURE.md) for patterns and conventions.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes with tests
4. Run `pnpm test && pnpm lint` to verify
5. Submit a pull request

---

## License

[MIT](LICENSE)
