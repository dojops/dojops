<p align="center">
  <img src="packages/api/public/logo/official-dojops-logo.png" alt="DojOps" width="120" />
</p>

<h1 align="center">DojOps AI DevOps Automation Engine</h1>

<p align="center">
  <strong>Enterprise-grade AI DevOps automation.</strong><br />
  Generate, validate, and execute infrastructure &amp; CI/CD configurations safely with structured output enforcement, sandboxed execution, approval workflows, and hash-chained audit trails.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;&middot;&nbsp;
  <a href="#features">Features</a> &nbsp;&middot;&nbsp;
  <a href="https://doc.dojops.ai">Documentation</a> &nbsp;&middot;&nbsp;
  <a href="https://hub.dojops.ai">Skill Hub</a> &nbsp;&middot;&nbsp;
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

```bash
# Install
npm i -g @dojops/cli

# Configure your LLM provider
dojops config

# Generate your first config
dojops "Create a Kubernetes deployment for nginx with 3 replicas"
```

<details>
<summary>Other install methods</summary>

```bash
# Homebrew (macOS / Linux)
brew tap dojops/tap && brew install dojops

# Shell script
curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh

# Docker
docker run --rm -it ghcr.io/dojops/dojops "Create a Terraform config for S3"
```

</details>

See the [installation guide](https://doc.dojops.ai/getting-started/installation) for detailed instructions.

---

## How It Works

```bash
# Simple: describe what you need
dojops "Create a Terraform config for S3 with versioning"

# Plan: decompose complex goals into task graphs
dojops plan "Set up CI/CD for a Node.js app"

# Execute: sandboxed writes with approval workflow
dojops apply

# Serve: web dashboard + REST API
dojops serve
```

DojOps routes your prompt to the right specialist agent, enforces structured output via Zod schemas, validates configs with external tools, and writes files through a sandboxed execution engine with approval gates and audit logging.

---

## Features

### Intelligence

- **17 specialist agents** — Terraform, Kubernetes, CI/CD, security, Docker, cloud architecture, and more. Create custom agents with `dojops agents create`
- **6 LLM providers** — OpenAI, Anthropic, Ollama (local), DeepSeek, Google Gemini, GitHub Copilot
- **CI debugging & diff analysis** — Paste CI logs or infrastructure diffs for structured diagnosis

### Skills

- **12+ built-in DevOps skills** — GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, GitLab CI, Prometheus, Systemd, Jenkinsfile
- **Custom skill system** — Write `.dops v2` manifests, publish to the [DojOps Hub](https://hub.dojops.ai), or install community skills
- **Schema-validated structured output** — Provider-native JSON modes with Zod validation

### Execution

- **Task planner** — LLM-powered goal decomposition into dependency-aware task graphs with risk classification
- **Sandboxed writes** — Atomic file writes restricted to infrastructure paths with `.bak` backups
- **Approval workflows** — Diff preview before every write. Auto-approve, auto-deny, or interactive
- **Resume on failure** — `dojops apply --resume` picks up where it left off

### Security

- **10 security scanners** — Trivy, Gitleaks, Checkov, Semgrep, Hadolint, ShellCheck, npm/pip audit, SBOM, license scanning
- **Deep verification** — External validators (terraform validate, hadolint, kubectl --dry-run) run before file writes
- **Policy engine** — Controls allowed paths, timeouts, file size limits, and environment variables
- **Immutable audit trail** — Hash-chained JSONL with SHA-256 integrity verification

### Platform

- **REST API** — 21 endpoints exposing all capabilities over HTTP
- **Web dashboard** — Dark terminal aesthetic with metrics, agents, history, and security views
- **Zero telemetry** — Nothing leaves your machine except requests to your LLM provider

For full details, see the [documentation](https://doc.dojops.ai).

---

## Architecture

```
@dojops/cli            CLI entry point + rich TUI
@dojops/api            REST API (Express) + web dashboard
@dojops/skill-registry Skill registry + custom skill/agent discovery
@dojops/planner        Task graph decomposition + topological executor
@dojops/executor       Sandbox + policy engine + approval + audit log
@dojops/runtime        12+ built-in DevOps skills (.dops v2)
@dojops/scanner        10 security scanners + remediation
@dojops/context        Context7 documentation augmentation
@dojops/session        Chat session management + memory
@dojops/core           LLM abstraction (6 providers) + 17 specialist agents
@dojops/sdk            BaseSkill<T> + Zod validation + file utilities
```

```
cli -> api -> skill-registry -> runtime -> core -> sdk
          -> planner -> executor
          -> scanner
          -> context -> core
          -> session -> core
```

See [docs/architecture.md](docs/architecture.md) for full system design.

---

## Development

```bash
git clone https://github.com/dojops/dojops.git
cd dojops
pnpm install
pnpm build              # Build all 11 packages via Turbo
pnpm test               # Run all tests
pnpm lint               # ESLint across all packages

# Per-package
pnpm --filter @dojops/core test

# Run locally (no global install)
pnpm dojops -- "Create a Terraform config for S3"
```

Requires **Node.js >= 20** and **pnpm >= 8**.

---

## Privacy

DojOps does not collect telemetry. No project data leaves your machine
except to your configured LLM provider. All generated configs, audit logs,
and scan reports are stored locally in your `.dojops/` directory.

---

## Contributing

Contributions are welcome! See the [contributing guide](docs/contributing.md) for development setup, coding standards, and how to add new skills and agents.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes with tests
4. Run `pnpm test && pnpm lint` to verify
5. Submit a pull request

---

## License

[MIT](LICENSE)
