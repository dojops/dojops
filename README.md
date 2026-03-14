<p align="center">
  <img src="packages/api/public/logo/official-dojops-logo.png" alt="DojOps" width="120" />
</p>

<h1 align="center">DojOps AI DevOps Automation Engine</h1>

<p align="center">
  <strong>Enterprise-grade AI DevOps automation.</strong><br />
  Generate, validate, and execute infrastructure &amp; CI/CD configurations safely with structured output enforcement, sandboxed execution, approval workflows, and hash-chained audit trails.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;·&nbsp;
  <a href="#features">Features</a> &nbsp;·&nbsp;
  <a href="#web-dashboard">Dashboard</a> &nbsp;·&nbsp;
  <a href="#cli-reference">CLI Reference</a> &nbsp;·&nbsp;
  <a href="#api-reference">API Reference</a> &nbsp;·&nbsp;
  <a href="#architecture">Architecture</a> &nbsp;·&nbsp;
  <a href="docs/">Docs</a> &nbsp;·&nbsp;
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dojops/cli"><img src="https://img.shields.io/npm/v/@dojops/cli?style=flat-square&color=00e5ff&label=version" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@dojops/cli"><img src="https://img.shields.io/npm/dm/@dojops/cli?style=flat-square&color=00e5ff&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/dojops/dojops/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dojops/dojops/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" /></a>
  <a href="https://github.com/dojops/dojops"><img src="https://img.shields.io/github/stars/dojops/dojops?style=flat-square&color=eab308" alt="GitHub stars" /></a>
  <a href="https://github.com/dojops/dojops/blob/main/LICENSE"><img src="https://img.shields.io/github/license/dojops/dojops?style=flat-square&color=blue" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/typescript-5.4+-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p align="center">
  <a href="https://sonarcloud.io/summary/new_code?id=dojops_dojops"><img src="https://sonarcloud.io/api/project_badges/measure?project=dojops_dojops&metric=alert_status" alt="Quality Gate Status" /></a>
</p>

<p align="center">
  <img src="assets/demo.svg" alt="DojOps CLI Demo — dojops plan" width="800" />
</p>

---

## Why DojOps?

1. **Manual IaC is slow** — Writing Terraform, Kubernetes, and CI/CD configs from scratch takes hours. Teams spend more time on boilerplate than architecture.
2. **AI-generated configs are unsafe** — LLMs produce plausible but unvalidated output. Without schema enforcement and execution controls, AI-generated infrastructure is a liability.
3. **Teams lack visibility into AI-driven changes** — When AI generates configs, there's no audit trail, no approval gate, and no way to resume partial failures. Compliance teams can't sign off on what they can't verify.

---

## Quick Start

### Prerequisites

- **Node.js** >= 20 (or **Docker** if using the container image)

### Install

```bash
# npm (recommended)
npm i -g @dojops/cli

# Homebrew (macOS / Linux)
brew tap dojops/tap && brew install dojops

# Shell script
curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh

# Docker
docker run --rm -it ghcr.io/dojops/dojops "Create a Terraform config for S3"
```

See [docs/installation.md](docs/installation.md) for detailed instructions, upgrade/uninstall, and troubleshooting.

### Shell Completion

```bash
dojops completion install   # auto-detects your shell
```

Or generate manually: `dojops completion bash|zsh|fish`

### Configure & Run

```bash
# 1. Configure your provider
dojops config                                  # Interactive wizard
# or: dojops provider add openai --token sk-...  # Direct setup

# 2. Generate your first config
dojops "Create a Kubernetes deployment for nginx with 3 replicas"
```

Or set environment variables directly:

```bash
export DOJOPS_PROVIDER=openai          # openai | anthropic | ollama | deepseek | gemini | github-copilot
export OPENAI_API_KEY=sk-...        # your API key
dojops "Create a Terraform config for S3 with versioning"
```

---

## How DojOps Works

### Simple Mode — Stateless CLI

```bash
dojops "Create a Terraform config for S3 with versioning"
dojops "Create a Dockerfile for a Node.js Express app"
dojops debug ci "ERROR: tsc failed with exit code 1..."
dojops analyze diff --file plan.diff
```

DojOps routes to the right specialist agent, enforces structured JSON output via Zod schemas, and returns validated configs.

### Enterprise Mode — Full Lifecycle

```bash
dojops init                              # Initialize project state + scan repo
dojops check                             # LLM-powered DevOps config quality check
dojops plan "Create CI/CD for Node app"  # Decompose into task graph
dojops validate                          # Validate plan against schemas
dojops apply                             # Execute with approval workflow
dojops apply --resume                    # Resume partially-failed plans
dojops history verify                    # Verify audit log integrity
dojops history show <plan-id>            # Inspect per-task results
```

Plans are persisted, execution is sandboxed, every action is audit-logged with hash-chained integrity, and partial failures can be resumed without re-executing completed tasks.

### Web Dashboard

```bash
dojops serve                             # Start at http://localhost:3000
dojops serve --port=8080                 # Custom port
```

The dashboard provides a visual interface with dark industrial terminal aesthetic for all DojOps capabilities — generate configs, decompose plans, debug CI logs, analyze infra diffs, browse agents, review execution history, and monitor observability metrics (overview, security findings, audit trail integrity).

---

## Features

### Intelligence

- **17 built-in specialist agents + custom agents** — ops-cortex, terraform, kubernetes, CI/CD, security, Docker, cloud architecture, networking, database, GitOps, compliance, CI debugger, appsec, shell scripting, Python, observability, and DevSecOps reviewer — with weighted keyword confidence scoring. Create your own custom agents via `dojops agents create` (LLM-generated or manual)
- **CI debugging** — Paste CI logs, get structured diagnosis with error type, root cause, affected files, and suggested fixes with confidence scores
- **Infra diff analysis** — Risk level, cost impact, security implications, rollback complexity, and actionable recommendations for infrastructure changes
- **DevOps config checker** — LLM-powered quality analysis of detected DevOps files with maturity scoring (0-100), severity-ranked findings, and missing file recommendations
- **6 LLM providers** — OpenAI, Anthropic, Ollama (local), DeepSeek, Google Gemini, GitHub Copilot — with dynamic model selection via provider API and temperature passthrough for deterministic reproducibility

### Skills

- **13 built-in DevOps skills** — GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd, Jenkinsfile
- **Declarative skill metadata** — `.dops` skills declare `scope` (write boundaries), `risk` (LOW/MEDIUM/HIGH self-classification), `execution` (deterministic/idempotent flags), `update` strategy, `context` block (v2: technology context, output guidance, best practices, Context7 libraries), and optional `icon` URLs for marketplace display. Scope enforcement rejects out-of-bounds writes at runtime
- **Custom skill system** — Extend DojOps with custom `.dops v2` skills. Drop a skill into `~/.dojops/skills/` or `.dojops/skills/` and it's automatically available to all commands. Scaffold new skills with `dojops skills init <name>`. Skill isolation enforces verification command whitelisting (33 allowed binaries), `child_process` permission gating, and path traversal prevention
- **Update existing configs** — Skills auto-detect existing config files, pass them to the LLM with "update/preserve" instructions, and create `.bak` backups before overwriting. Supports both auto-detection and explicit `existingContent` input
- **Schema-validated** — Every skill input is validated against Zod schemas before execution
- **Deep verification** — Verification runs by default through external validators (terraform validate, hadolint, kubectl dry-run) before writing files. Missing verification tools are auto-installed via the toolchain. Use `--skip-verify` to disable
- **Idempotent YAML output** — YAML keys are sorted alphabetically (GitHub Actions uses conventional key ordering) for deterministic, diff-friendly output
- **Structured output** — Provider-native JSON modes (OpenAI `response_format`, Anthropic prefill, Ollama `format`, Gemini `responseMimeType`)

### Execution

- **Task planner** — LLM-powered goal decomposition into dependency-aware task graphs with topological execution (Kahn's algorithm)
- **Risk-aware planning** — Plans are automatically classified as LOW / MEDIUM / HIGH risk based on skill types and keyword analysis (IAM, production, secrets, RBAC). HIGH risk plans require explicit confirmation even with `--yes`
- **Verification pipeline** — `verify()` step between generate and execute validates output with external validators (terraform validate, hadolint, kubectl dry-run) and built-in structure linters (GitHub Actions, GitLab CI). Enabled by default; use `--skip-verify` to skip
- **Drift awareness** — Pre-apply warnings for stateful skills (Terraform, Kubernetes, Helm, Ansible) remind users to verify remote state before applying local config changes
- **Git dirty check** — `apply` warns when uncommitted changes exist in the working tree. Use `--force` to skip
- **Atomic file writes** — All file writes use temp-file + rename for crash safety (no partial writes)
- **DevOps write allowlist** — By default, only DevOps files (CI configs, Dockerfiles, Terraform, K8s manifests, etc.) can be written. Prevents LLM-generated code from mutating application source. Use `--allow-all-paths` to bypass
- **Sandboxed execution** — `SandboxedFs` restricts file operations to policy-allowed paths with per-file size limits (1MB default), execution timeouts (30s default), and atomic writes. These guardrails apply uniformly to both built-in skills and custom skills
- **Policy engine** — `ExecutionPolicy` controls write permissions, allowed/denied paths, DevOps allowlist, environment variables, timeouts, file size limits, and verification toggle
- **Approval workflows** — Auto-approve, auto-deny, or interactive callback with diff preview before any write operation
- **Resume on failure** — `dojops apply --resume` skips completed tasks and retries failed ones
- **Deterministic replay** — `dojops apply --replay` forces temperature=0 and validates that provider, model, and custom skill system prompts match the plan's execution context for deterministic execution under identical provider and model conditions
- **Plan snapshot freezing** — Plans capture DojOps version, policy hash, and skill versions at creation time. Version drift is detected at apply time (warning in normal mode, blocking in `--replay` mode)

### Observability

- **Metrics dashboard** — Overview (plans, success rate, execution time, critical issues), Security (severity breakdown, findings trend, top issues, scan history), and Audit (chain integrity, status breakdown, command distribution, timeline) — with 30-second auto-refresh
- **Hash-chained audit logs** — Tamper-evident JSONL audit trail with SHA-256 chain integrity verification via `dojops history verify`. JSONL format is compatible with SIEM ingestion (Splunk, ELK, Datadog)
- **Token usage analytics** — `dojops tokens` tracks LLM token usage per provider and command with daily and total summaries
- **Opportunity detection** — `dojops insights` analyzes project history to surface actionable insights across efficiency, security, quality, and cost categories
- **Error pattern learning** — Automatic error fingerprinting, deduplication, and occurrence tracking across all commands. Recurring patterns are surfaced in `dojops insights`
- **Project memory** — `dojops memory` stores persistent project notes with keyword-based search and RAG-style injection into LLM context for smarter generation
- **Execution locking** — PID-based lock files prevent concurrent mutations with automatic stale-lock cleanup
- **Rich terminal UI** — Interactive prompts, spinners, styled panels, semantic log levels — powered by `@clack/prompts`
- **Doctor diagnostics** — `dojops doctor` shows system health plus project metrics summary (plans, success rate, scan count, audit chain integrity). Always shows installed toolchain binaries regardless of project context

### Platform

- **REST API** — 21 endpoints exposing all capabilities over HTTP with Zod request validation, API v1 versioning (`/api/v1/` prefix with backward-compatible `/api/` alias)
- **Web dashboard** — Single-page app with dark terminal aesthetic, 5 tabs (Overview, Security, Audit, Agents, History), toast notifications, responsive layout
- **Metrics API** — 5 GET endpoints (`/api/metrics`, `/overview`, `/security`, `/audit`, `/tokens`) powered by `MetricsAggregator` reading `.dojops/` data on-demand
- **Configuration profiles** — Named profiles for switching between providers/environments

---

## Architecture

```
@dojops/cli            CLI entry point + rich TUI (@clack/prompts)
@dojops/api            REST API (Express) + web dashboard + factory functions
@dojops/skill-registry Skill registry + custom skill system + custom agent discovery
@dojops/planner        TaskGraph decomposition + topological executor
@dojops/executor       SafeExecutor: sandbox + policy engine + approval + audit log
@dojops/runtime        13 built-in DevOps skills as .dops v2 files (DopsRuntime)
@dojops/scanner        10 security scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint,
                       shellcheck, trivy-sbom, trivy-license, semgrep) + remediation
@dojops/context        Context7 documentation augmentation for v2 skills
@dojops/session        Chat session management + memory + context injection
@dojops/core           LLM abstraction + 6 providers + 17 built-in specialist agents + CI debugger + infra diff + DevOps checker
@dojops/sdk            BaseSkill<T> abstract class with Zod validation + optional verify() + file-reader utilities
                       + atomicWriteFileSync + restoreBackup
```

### Package Dependency Flow

```
cli -> api -> skill-registry -> runtime -> core -> sdk
          -> planner -> executor
          -> scanner
          -> context -> core
          -> session -> core
```

Full architecture details in [docs/architecture.md](docs/architecture.md).

---

## CLI Reference

### Commands

#### Generation & Planning

| Command                          | Description                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| `dojops <prompt>`                | Generate DevOps config (default command)                    |
| `dojops generate <prompt>`       | Explicit generation (same as default)                       |
| `dojops plan <prompt>`           | Decompose goal into dependency-aware task graph             |
| `dojops plan --execute <prompt>` | Plan + execute with approval workflow                       |
| `dojops apply [<plan-id>]`       | Execute a saved plan                                        |
| `dojops apply --skip-verify`     | Skip external config verification (on by default)           |
| `dojops apply --resume`          | Resume a partially-failed plan                              |
| `dojops apply --retry`           | Retry failed tasks when used with `--resume`                |
| `dojops apply --replay`          | Deterministic replay: temp=0, validate env match            |
| `dojops apply --dry-run`         | Preview changes without writing files                       |
| `dojops apply --force`           | Skip git dirty check, HIGH risk gate, and replay validation |
| `dojops apply --allow-all-paths` | Bypass DevOps file write allowlist                          |
| `dojops validate [<plan-id>]`    | Validate plan against schemas                               |
| `dojops explain [<plan-id>]`     | LLM explains a plan in plain language                       |

#### Diagnostics & Analysis

| Command                      | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `dojops check`               | LLM-powered DevOps config quality check (score 0-100) |
| `dojops check --fix`         | Auto-remediate HIGH/CRITICAL findings via LLM         |
| `dojops debug ci <log>`      | Diagnose CI/CD log failures (root cause, fixes)       |
| `dojops analyze diff --file` | Analyze infrastructure diff (risk, cost, security)    |
| `dojops scan`                | Security scan: vulnerabilities, deps, IaC, secrets    |
| `dojops scan --security`     | Run security scanners only (trivy, gitleaks)          |
| `dojops scan --deps`         | Run dependency audit only (npm, pip)                  |
| `dojops scan --iac`          | Run IaC scanners only (checkov, hadolint)             |
| `dojops scan --sbom`         | Generate SBOM (CycloneDX) with hash tracking          |
| `dojops scan --license`      | Run license compliance scanners (trivy-license)       |
| `dojops scan --fix`          | Generate and apply LLM-powered remediation            |
| `dojops scan --compare`      | Compare findings with previous scan report            |
| `dojops review [files...]`   | DevSecOps review: skill validation + LLM analysis     |
| `dojops review --context7`   | Review with Context7 documentation augmentation       |

#### Interactive

| Command                      | Description                                            |
| ---------------------------- | ------------------------------------------------------ |
| `dojops chat`                | Interactive multi-turn AI DevOps session               |
| `dojops chat --session=NAME` | Resume or create a named session                       |
| `dojops chat --resume`       | Resume the most recent session                         |
| `dojops chat --agent=NAME`   | Pin conversation to a specialist agent                 |
| `dojops chat --message=TEXT` | Send a single message and exit (scriptable, also `-m`) |

Chat supports slash commands: `/exit`, `/agent <name>`, `/plan <goal>`, `/apply`, `/scan`, `/history`, `/clear`, `/save`.

#### Agents & Skills

| Command                           | Description                                               |
| --------------------------------- | --------------------------------------------------------- |
| `dojops agents list`              | List all agents (built-in + custom)                       |
| `dojops agents info <name>`       | Show agent details (supports partial names)               |
| `dojops agents create <desc>`     | Create a custom agent (LLM-generated)                     |
| `dojops agents create --manual`   | Create a custom agent interactively                       |
| `dojops agents remove <name>`     | Remove a custom agent                                     |
| `dojops skills list`              | List discovered custom skills (global + project)          |
| `dojops skills validate <path>`   | Validate a custom skill manifest                          |
| `dojops skills init <name>`       | Scaffold a v2 `.dops` skill (with optional AI generation) |
| `dojops skills publish <file>`    | Publish a .dops skill to the DojOps Hub                   |
| `dojops skills install <name>`    | Install a .dops skill from the DojOps Hub                 |
| `dojops skills search <query>`    | Search the DojOps Hub for skills                          |
| `dojops toolchain list`           | List system toolchain binaries with install status        |
| `dojops toolchain install <name>` | Download binary into toolchain (~/.dojops/toolchain/)     |
| `dojops toolchain remove <name>`  | Remove a toolchain binary                                 |
| `dojops toolchain clean`          | Remove all toolchain binaries                             |
| `dojops inspect [<target>]`       | Inspect config and/or session state (default: both)       |

#### History & Audit

| Command                         | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `dojops history list`           | View execution history                                                |
| `dojops history show <plan-id>` | Show plan details and per-task results                                |
| `dojops history verify`         | Verify audit log hash chain integrity                                 |
| `dojops history audit`          | List audit log entries                                                |
| `dojops history repair`         | Repair broken audit log hash chain                                    |
| `dojops clean [<plan-id>]`      | Remove generated artifacts from a plan                                |
| `dojops rollback <plan-id>`     | Reverse an applied plan (delete created files + restore .bak backups) |

#### Provider Management

| Command                                    | Description                                    |
| ------------------------------------------ | ---------------------------------------------- |
| `dojops provider`                          | List all providers with status (alias: `list`) |
| `dojops provider add <name> [--token KEY]` | Add/configure a provider token                 |
| `dojops provider remove <name>`            | Remove a provider token                        |
| `dojops provider default <name>`           | Set the default provider                       |
| `dojops provider switch`                   | Interactive picker to switch default provider  |
| `dojops provider --as-default <name>`      | Set default provider (shortcut)                |

#### Configuration & Server

| Command                             | Description                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `dojops config`                     | Configure provider, model, tokens (interactive)                                           |
| `dojops config show`                | Display current configuration                                                             |
| `dojops config profile create NAME` | Save current config as a named profile                                                    |
| `dojops config profile use NAME`    | Switch to a named profile                                                                 |
| `dojops config profile list`        | List all profiles                                                                         |
| `dojops auth login`                 | Authenticate with LLM provider                                                            |
| `dojops auth status`                | Show saved tokens and default provider                                                    |
| `dojops serve [--port=N]`           | Start API server + web dashboard                                                          |
| `dojops serve --no-auth`            | Start server without API key authentication (local dev only)                              |
| `dojops serve --tls-cert --tls-key` | Enable HTTPS/TLS on the API server                                                        |
| `dojops serve credentials`          | Generate API key for dashboard/API authentication                                         |
| `dojops init`                       | Initialize `.dojops/` + comprehensive repo scan (11 CI platforms, IaC, scripts, security) |
| `dojops tokens`                     | Show LLM token usage analytics (per provider, daily, total)                               |
| `dojops insights [category]`        | Surface actionable insights from project history (`--all` for full list)                  |
| `dojops memory list`                | List persistent project notes (`--category` to filter)                                    |
| `dojops memory add <text>`          | Add a project note (`--category`, `--keywords`)                                           |
| `dojops memory remove <id>`         | Remove a project note                                                                     |
| `dojops memory search <query>`      | Search notes by keyword                                                                   |
| `dojops config backup`              | Save current config as a timestamped backup                                               |
| `dojops config restore [file]`      | Restore config from a backup                                                              |
| `dojops config apply <file>`        | Import config from a YAML/JSON file                                                       |
| `dojops config export <file>`       | Export current config to a file                                                           |
| `dojops status`                     | System health diagnostics + project metrics (alias: `doctor`)                             |
| `dojops upgrade`                    | Check for and install CLI updates (`--check` for check-only)                              |

### Global Options

| Option              | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--provider=NAME`   | LLM provider: `openai`, `anthropic`, `ollama`, `deepseek`, `gemini`, `github-copilot` |
| `--model=NAME`      | LLM model override                                                                    |
| `--temperature=N`   | LLM temperature (0-2) for deterministic reproducibility                               |
| `--profile=NAME`    | Use named config profile                                                              |
| `--skill=NAME`      | Force a specific skill for `generate`, `plan`, or `apply` (bypasses agent routing)    |
| `--file, -f FILE`   | Read prompt from a file (`.md`, `.txt`); combinable with inline prompt                |
| `--output=FORMAT`   | Output: `table` (default), `json`, `yaml`                                             |
| `--verbose`         | Verbose output                                                                        |
| `--debug`           | Debug-level output with stack traces                                                  |
| `--quiet`           | Suppress non-essential output                                                         |
| `--no-color`        | Disable color output                                                                  |
| `--non-interactive` | Disable interactive prompts                                                           |
| `--yes`             | Auto-approve all confirmations (implies `--non-interactive`)                          |
| `--help, -h`        | Show help message                                                                     |

### Exit Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | Success                              |
| 1    | General error                        |
| 2    | Validation error                     |
| 3    | Approval required                    |
| 4    | Lock conflict (concurrent operation) |
| 5    | No `.dojops/` project                |
| 6    | HIGH security findings detected      |
| 7    | CRITICAL security findings detected  |

### Examples

```bash
# Generate configs
dojops "Create a Terraform config for S3"
dojops "Write a Kubernetes deployment for nginx"
dojops "Set up monitoring with Prometheus"

# Update existing configs (auto-detects existing files, creates .bak backup)
dojops "Add caching to the GitHub Actions workflow"
dojops "Add a Redis service to docker-compose"
dojops "Add S3 bucket to the existing Terraform config"

# Read prompt from a file
dojops --file requirements.md
dojops --file spec.txt "Use Terraform"    # inline prompt + file content
dojops plan -f infrastructure-spec.md

# Plan and execute
dojops plan "Set up CI/CD for a Node.js app"
dojops plan --execute --yes "Create CI for Node app"
dojops apply --skip-verify       # skip external validation (on by default)
dojops apply --dry-run
dojops apply --resume --yes
dojops apply --replay                    # Deterministic replay (temp=0, validate env)

# Diagnose and analyze
dojops debug ci "ERROR: tsc failed with exit code 1..."
dojops analyze diff --file plan.diff
dojops explain last

# DevOps quality check
dojops check
dojops check --output json

# Security scanning
dojops scan
dojops scan --security
dojops scan --fix --yes
dojops scan --compare

# Interactive chat
dojops chat
dojops chat --session myproject --agent terraform

# Toolchain management (system binaries)
dojops toolchain install terraform
dojops toolchain install kubectl

# Custom skill management
dojops skills list
dojops skills init my-skill                 # .dops scaffold (AI-powered when provider is configured)
dojops skills validate my-skill

# Search the DojOps Hub for skills
dojops skills search docker
dojops skills search terraform --limit 5
dojops skills search k8s --output json

# Publish & install skills from DojOps Hub (https://hub.dojops.ai)
dojops skills publish my-skill.dops --changelog "Initial release"
dojops skills install nginx-config
dojops skills install nginx-config --version 1.0.0 --global

# Force a specific skill (bypass agent routing)
dojops --skill=terraform "Create an S3 bucket with versioning"
dojops --skill=kubernetes "Create a deployment for nginx"
dojops --skill=terraform plan "Set up S3 with CloudFront"

# Custom agents
dojops agents create "an SRE specialist for incident response"
dojops agents create --manual
dojops agents list
dojops agents info sre                      # partial name match
dojops agents remove sre-specialist

# Provider management
dojops provider                                # List all providers
dojops provider add openai --token sk-...      # Add a provider
dojops provider add anthropic --token sk-ant-... # Add another
dojops provider switch                         # Interactive picker
dojops provider default anthropic              # Set default directly

# Administration
dojops doctor
dojops history list
dojops history verify
dojops serve --port=8080
dojops config profile create staging
```

---

## Security & Compliance

DojOps implements defense-in-depth for AI-driven infrastructure changes:

| Layer                   | Mechanism                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Output enforcement**  | All LLM responses constrained to JSON schemas via provider-native modes                                                                           |
| **Skill isolation**     | Verification command whitelist (33 binaries), `child_process` permission enforcement, path traversal prevention                                   |
| **Schema validation**   | Every skill input and LLM output validated against Zod schemas before execution                                                                   |
| **Deep verification**   | External tool validation by default: `terraform validate`, `hadolint`, `kubectl --dry-run=client` — before file write. `--skip-verify` to disable |
| **Policy engine**       | `ExecutionPolicy` controls write permissions, allowed/denied paths, env vars, timeouts, file size limits                                          |
| **Approval workflows**  | Configurable handlers: auto-approve, auto-deny, or interactive callback with diff preview                                                         |
| **Sandboxed execution** | `SandboxedFs` restricts file operations to policy-allowed paths with atomic writes and audit logging                                              |
| **Encrypted vault**     | AES-256-GCM encrypted secrets vault for API tokens with scrypt key derivation. Replaces plaintext token storage                                   |
| **Audit trail**         | Append-only JSONL with SHA-256 hash chaining (seq + previousHash + hash). Tamper detection via `dojops history verify`                            |
| **Execution locking**   | PID-based lock files prevent concurrent mutations with automatic stale-lock cleanup                                                               |

---

## Skills

| Skill          | Serialization      | Output Files                        | Verifier             |
| -------------- | ------------------ | ----------------------------------- | -------------------- |
| GitHub Actions | YAML               | `.github/workflows/ci.yml`          | ---                  |
| Terraform      | HCL                | `main.tf`, `variables.tf`           | `terraform validate` |
| Kubernetes     | YAML               | K8s manifests                       | `kubectl --dry-run`  |
| Helm           | YAML               | `Chart.yaml`, `values.yaml`         | `helm lint`          |
| Ansible        | YAML               | `{name}.yml`                        | `ansible-playbook`   |
| Docker Compose | YAML               | `docker-compose.yml`                | ---                  |
| Dockerfile     | Dockerfile syntax  | `Dockerfile`, `.dockerignore`       | `hadolint`           |
| Nginx          | Nginx conf         | `nginx.conf`                        | ---                  |
| Makefile       | Make syntax (tabs) | `Makefile`                          | ---                  |
| GitLab CI      | YAML               | `.gitlab-ci.yml`                    | ---                  |
| Prometheus     | YAML               | `prometheus.yml`, `alert-rules.yml` | ---                  |
| Systemd        | INI                | `{name}.service`                    | ---                  |
| Jenkinsfile    | Groovy DSL         | `Jenkinsfile`                       | ---                  |

All 13 built-in skills are `.dops v2` files in `packages/runtime/skills/`, processed by `DopsRuntime` — generating raw file content directly via LLM. Skills auto-detect and update existing config files with `.bak` backup. All file writes are atomic (temp + rename).

---

## Specialist Agents

DojOps includes 17 built-in agents plus support for user-defined custom agents. Custom agents are created via `dojops agents create` and stored as markdown README files — no source code changes needed.

| Agent                    | Domain                  | Key Capabilities                                                     |
| ------------------------ | ----------------------- | -------------------------------------------------------------------- |
| ops-cortex               | Orchestration           | Task decomposition, cross-domain routing, dependency ordering        |
| terraform-specialist     | Infrastructure          | HCL, modules, state management, workspaces, cost optimization        |
| kubernetes-specialist    | Container orchestration | Deployments, Helm, RBAC, autoscaling, service mesh                   |
| cicd-specialist          | CI/CD                   | GitHub Actions, GitLab CI, Jenkins, build optimization, pipelines    |
| security-auditor         | Security                | Vulnerability scanning, secret management, IAM, threat modeling      |
| observability-specialist | Observability           | Prometheus, Grafana, Datadog, tracing, SLOs, alerting                |
| docker-specialist        | Containerization        | Multi-stage builds, image optimization, registries, BuildKit         |
| cloud-architect          | Cloud architecture      | AWS/GCP/Azure design, cost optimization, migration strategies        |
| network-specialist       | Networking              | DNS, load balancers, VPN, CDN, service mesh, firewall rules          |
| database-specialist      | Data storage            | PostgreSQL, MySQL, Redis, DynamoDB, replication, backup              |
| gitops-specialist        | GitOps                  | ArgoCD, Flux, drift detection, sealed secrets, progressive delivery  |
| compliance-auditor       | Compliance              | SOC2, HIPAA, PCI-DSS, GDPR, policy-as-code (OPA/Rego)                |
| ci-debugger              | CI debugging            | Log analysis, root cause diagnosis, flaky test detection             |
| appsec-specialist        | Application security    | OWASP Top 10, SAST/DAST, code review, pentest methodology            |
| shell-specialist         | Shell scripting         | Bash/POSIX, ShellCheck, error handling, automation                   |
| python-specialist        | Python scripting        | Type hints, pytest, poetry, async, CLI tools                         |
| devsecops-reviewer       | DevOps review           | Config review, version validation, deprecated syntax, security audit |

---

## API Reference

### Endpoints

| Method   | Path                     | Description                                           |
| -------- | ------------------------ | ----------------------------------------------------- |
| `GET`    | `/api/health`            | Provider info, skill list, metricsEnabled flag        |
| `POST`   | `/api/generate`          | Agent-routed LLM generation                           |
| `POST`   | `/api/plan`              | Decompose goal into task graph                        |
| `POST`   | `/api/debug-ci`          | Diagnose CI log failures                              |
| `POST`   | `/api/diff`              | Analyze infrastructure diff                           |
| `POST`   | `/api/scan`              | Run security scan (all, security, deps, iac, sbom)    |
| `POST`   | `/api/review`            | DevSecOps review with skill validation + LLM analysis |
| `POST`   | `/api/chat`              | Send chat message to a session                        |
| `POST`   | `/api/chat/sessions`     | Create new chat session                               |
| `GET`    | `/api/chat/sessions`     | List all chat sessions                                |
| `GET`    | `/api/chat/sessions/:id` | Get chat session by ID                                |
| `DELETE` | `/api/chat/sessions/:id` | Delete chat session                                   |
| `GET`    | `/api/agents`            | List specialist agents                                |
| `GET`    | `/api/history`           | Execution history                                     |
| `GET`    | `/api/history/:id`       | Single history entry                                  |
| `DELETE` | `/api/history`           | Clear history                                         |
| `GET`    | `/api/metrics`           | Full dashboard metrics (overview + security + audit)  |
| `GET`    | `/api/metrics/overview`  | Plan/execution/scan aggregates                        |
| `GET`    | `/api/metrics/security`  | Scan findings, severity trends, top issues            |
| `GET`    | `/api/metrics/audit`     | Audit chain integrity, command distribution           |
| `GET`    | `/api/metrics/tokens`    | LLM token usage tracking                              |

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

| Provider       | `DOJOPS_PROVIDER` | Required Env Var      | Default Model                |
| -------------- | ----------------- | --------------------- | ---------------------------- |
| OpenAI         | `openai`          | `OPENAI_API_KEY`      | `gpt-4o-mini`                |
| Anthropic      | `anthropic`       | `ANTHROPIC_API_KEY`   | `claude-sonnet-4-5-20250929` |
| Ollama         | `ollama`          | _(none --- local)_    | `llama3`                     |
| DeepSeek       | `deepseek`        | `DEEPSEEK_API_KEY`    | `deepseek-chat`              |
| Gemini         | `gemini`          | `GEMINI_API_KEY`      | `gemini-2.5-flash`           |
| GitHub Copilot | `github-copilot`  | _(OAuth Device Flow)_ | `gpt-4o`                     |

### Model Selection

Each provider ships with a sensible default, but you can choose any model your provider supports:

```bash
dojops config                          # Interactive: fetches models, shows picker
dojops config --model=gpt-4o           # Set directly
dojops --model=deepseek-reasoner "..." # One-off override
```

### Configuration Precedence

```
Provider:     --provider     >  $DOJOPS_PROVIDER     >  config  >  openai
Model:        --model        >  $DOJOPS_MODEL        >  config  >  provider default
Temperature:  --temperature  >  $DOJOPS_TEMPERATURE  >  config  >  undefined (provider default)
Token:        $OPENAI_API_KEY / $ANTHROPIC_API_KEY / ...  >  config token
```

### Profiles

```bash
dojops config profile create staging     # Save current config as "staging"
dojops config profile use staging        # Switch to staging profile
dojops config profile list               # List all profiles
dojops --profile=staging "Create S3..."  # One-off profile override
```

---

## Development

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 8
- **TypeScript** >= 5.4

### Setup

```bash
git clone https://github.com/dojops/dojops.git
cd dojops
pnpm install
pnpm build
```

### Commands

```bash
pnpm build              # Build all packages via Turbo
pnpm dev                # Dev mode (no caching)
pnpm test               # Run all 2649 tests
pnpm lint               # ESLint across all packages
pnpm format             # Prettier write
pnpm format:check       # Prettier check (CI)

# Per-package
pnpm --filter @dojops/core test
pnpm --filter @dojops/api build
pnpm --filter @dojops/runtime lint

# Run locally (no global install)
pnpm dojops -- "Create a Terraform config for S3"
pnpm dojops -- serve --port=8080
```

### Project Structure

```
packages/
  cli/              CLI entry point + TUI (@clack/prompts)
  api/              REST API (Express) + web dashboard
  skill-registry/   Skill registry + custom skill system + custom agent discovery
  core/             LLM providers (6) + specialist agents (17 built-in) + CI debugger + infra diff + DevOps checker
  planner/          Task graph decomposition + topological executor
  executor/         SafeExecutor + policy engine + approval workflows + audit log
  runtime/          13 built-in DevOps skills as .dops v2 files (DopsRuntime)
  scanner/          10 security scanners + LLM-powered remediation
  context/          Context7 documentation augmentation for v2 skills
  session/          Chat session management + memory + context injection
  sdk/              BaseSkill<T> abstract class + Zod re-export + verification types + file-reader utilities
```

### Test Coverage

| Package                  | Tests    |
| ------------------------ | -------- |
| `@dojops/runtime`        | 656      |
| `@dojops/cli`            | 575      |
| `@dojops/core`           | 541      |
| `@dojops/skill-registry` | 277      |
| `@dojops/api`            | 244      |
| `@dojops/scanner`        | 110      |
| `@dojops/executor`       | 81       |
| `@dojops/sdk`            | 55       |
| `@dojops/planner`        | 40       |
| `@dojops/session`        | 38       |
| `@dojops/context`        | 32       |
| **Total**                | **2649** |

---

## Publishing

All packages are published under the `@dojops` scope:

```bash
npm login
pnpm publish-packages    # Build + publish in dependency order
```

Publish order: `sdk` -> `core` -> `context` -> `executor` -> `planner` -> `runtime` -> `skill-registry` -> `scanner` -> `session` -> `api` -> `cli`

---

## Privacy & Telemetry

DojOps does not collect telemetry. No project data leaves your machine
except to your configured LLM provider. All generated configs, audit logs,
and scan reports are stored locally in your `.dojops/` directory.

---

## Contributing

Contributions are welcome! Please see the [contributing guide](docs/contributing.md) for development setup, coding standards, and how to add new skills and agents. See [docs/architecture.md](docs/architecture.md) for system design patterns.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes with tests
4. Run `pnpm test && pnpm lint` to verify
5. Submit a pull request

---

## License

[MIT](LICENSE)
