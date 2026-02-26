# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-26

### Added

- **LLM Providers**: 5 providers (OpenAI, Anthropic, Ollama, DeepSeek, Gemini) with structured JSON output via Zod schemas, temperature passthrough, and dynamic model selection via `listModels()`.
- **DevOps Tools**: 12 built-in tools (GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd) with generate, detect, verify, and execute lifecycle.
- **Plugin System**: Declarative `plugin.yaml` manifests with JSON Schema input validation, plugin discovery from global (`~/.dojops/plugins/`) and project (`.dojops/plugins/`) directories, policy enforcement via `.dojops/policy.yaml`, verification command whitelist, and path traversal prevention.
- **Specialist Agents**: 16 built-in specialist agents (ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python) with keyword-based routing and confidence scoring. Custom agent discovery from `.dojops/agents/` README.md files.
- **Security Scanning**: 8 scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom) supporting `--security`, `--deps`, `--iac`, and `--sbom` scan modes with structured reports saved to `.dojops/scans/`.
- **REST API & Web Dashboard**: Express-based API with 19 endpoints for generation, planning, debugging, scanning, chat, agents, history, and metrics. Vanilla web dashboard with dark theme and 5 tabs (Overview, Security, Audit, Agents, History).
- **CLI**: Rich terminal UI via `@clack/prompts` with commands for `init`, `plan`, `validate`, `apply`, `destroy`, `rollback`, `explain`, `debug ci`, `analyze diff`, `chat`, `scan`, `serve`, `agents`, `history`, `tools`, and more.
- **Sandboxed Execution**: `SafeExecutor` with `ExecutionPolicy` (write/path/env/timeout/size restrictions), `SandboxedFs` for restricted file operations, and `ApprovalHandler` interface (auto-approve, auto-deny, callback).
- **Audit Trails**: Hash-chained JSONL audit logs with verification results, plugin metadata, execution context, and `systemPromptHash` tracking.
- **Plan Lifecycle**: `Plan -> Validate -> Apply` workflow with `TaskGraph` decomposition, topological execution, `$ref:<taskId>` input wiring, `--resume` for interrupted plans, `--replay` deterministic mode, and plugin version pinning.
- **CI Debugger**: Analyzes CI logs and produces structured `CIDiagnosis` (error type, root cause, fixes, confidence).
- **Infra Diff Analyzer**: Analyzes infrastructure diffs and produces `InfraDiffAnalysis` (risk level, cost impact, security impact, recommendations).
- **Chat Sessions**: Interactive multi-turn conversation support with session persistence and agent routing.
- **Metrics Dashboard**: `MetricsAggregator` for `.dojops/` data aggregation (plans, executions, scans, audit) with Overview, Security, and Audit dashboard tabs.
- **Trust Hardening**: Hard file write allowlist, plan snapshot freezing, risk classification, drift awareness warnings, SBOM persistence versioning, change impact summary, CI provider schema validation.
- **Atomic File Writes**: Write to `.tmp` then rename for crash safety across all 12 tools and `SandboxedFs`.
- **Dev Tooling**: 973 Vitest tests, ESLint, Prettier, Husky + lint-staged, Turbo monorepo build.
