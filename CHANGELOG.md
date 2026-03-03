# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2026-03-03

### Added

- **Primary Keywords**: Specialist agents now support `primaryKeywords` — high-signal keywords that receive a confidence boost (+0.1 per match) during routing, improving agent selection accuracy
- **Project-Context Biased Routing**: Agent routing now considers project domains detected by `dojops init`, boosting confidence (+0.15) for agents whose domain matches the project context
- **Agent Retry & Timeout**: `SpecialistAgent.run()` and `runWithHistory()` now support configurable timeout (default 120s) and automatic single retry on transient errors (network/5xx/429)
- **Message Size Validation**: `runWithHistory()` now filters out oversized messages (>128KB) to prevent LLM context overflow

### Changed

- **TUI Output Limits**: Increased `formatOutput` line limit from 20 to 50 and apply preview limit from 2000 to 5000 characters for better visibility of large outputs
- **TUI Word Wrapping**: Added `wrapForNote()` utility for ANSI-safe word-wrapping in `p.note()` boxes, applied across check, debug, analyze, explain, plan, apply, and scan commands — fixes broken box-drawing characters when content exceeds terminal width

### Fixed

- **Project-Aware Tool Filtering**: `init`, `status`/`doctor`, and `check` commands now filter optional tool suggestions by detected project domains — no more suggesting Makefile for Java projects or Terraform for Node.js apps
- **Check Command Relevance**: The `check` command now includes project-type constraints in the LLM system prompt, producing domain-relevant maturity findings only
- **Message Sanitization**: `runWithHistory()` now sanitizes all message roles (not just user messages) for consistent input handling

### Removed

- **Unused Icon Asset**: Removed `packages/cli/assets/dojops-icon.png` and its copy logic from `initProject()` — the CLI never displayed it; the dashboard uses its own icon from `api/public/icons/`

## [1.0.3] - 2026-03-02

### Fixed

- **Hub URL Default**: Changed `DOJOPS_HUB_URL` default from `http://localhost:3000` to `https://hub.dojops.ai` so `tools publish`, `tools install`, and `tools search` connect to the production hub out of the box

## [1.0.2] - 2026-03-02

First official public release. Versions 1.0.0 and 1.0.1 were internal testing releases.

### Added

- **LLM Providers**: 6 providers (OpenAI, Anthropic, Ollama, DeepSeek, Gemini, GitHub Copilot) with structured JSON output via Zod schemas, temperature passthrough, and dynamic model selection via `listModels()`. GitHub Copilot uses OAuth Device Flow with JWT auto-refresh.
- **DevOps Tools**: 12 built-in tools (GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd) with generate, detect, verify, and execute lifecycle.
- **Plugin System**: Declarative `plugin.yaml` manifests with JSON Schema input validation, plugin discovery from global (`~/.dojops/plugins/`) and project (`.dojops/plugins/`) directories, policy enforcement via `.dojops/policy.yaml`, verification command whitelist, and path traversal prevention.
- **Specialist Agents**: 16 built-in specialist agents (ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python) with keyword-based routing and confidence scoring. Custom agent discovery from `.dojops/agents/` README.md files.
- **Security Scanning**: 9 scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom, semgrep) supporting `--security`, `--deps`, `--iac`, and `--sbom` scan modes with structured reports saved to `.dojops/scans/`. Scan comparison via `--compare` flag shows new/resolved findings.
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
- **DOPS Spec Hardening**: 5 new `.dops` frontmatter sections for v1 contract freeze:
  - `scope` — Write boundary enforcement with `{var}` path expansion; out-of-scope writes rejected at runtime
  - `risk` — Tool self-classification (`LOW`/`MEDIUM`/`HIGH`) with rationale; exposed in `ToolMetadata.riskLevel`
  - `execution` — Mutation semantics: `mode` (generate/update), `deterministic`, `idempotent` flags
  - `update` — Structured update behavior: `strategy` (replace/preserve_structure), `inputSource`, `injectAs`
  - `meta.icon` — Optional HTTPS URL (max 2048 chars) for marketplace tool icon display
- **Scope Enforcement in File Writer**: `writeFiles()` validates resolved paths against `scope.write` patterns after variable expansion; `matchesScopePattern()` helper exported
- **Risk & Execution Getters**: `DopsRuntime.risk`, `.executionMode`, `.isDeterministic`, `.isIdempotent` with safe defaults
- **Parser Validation**: Path traversal prevention on `scope.write` paths; network permission constraint for v1 tools with risk declared
- **Prompt Compiler Update Strategy**: `preserve_structure` injects additional LLM instructions; `injectAs` controls variable name for existing content
- **12 Module Updates**: All built-in `.dops` modules updated with `scope`, `risk`, `execution`, and `update` sections
- **Test Coverage**: New unit tests across packages to meet 75% coverage threshold
- **Tool Command `new` Option**: `dojops tools new` scaffolds a new custom tool from a template
- **Tool Subcommands**: Additional `dojops tools` subcommands for managing tool lifecycle
- **Release Workflow**: Changelog-driven GitHub Release notes (replaces auto-generated notes)
- **Dev Tooling**: 1931+ Vitest tests, ESLint, Prettier, Husky + lint-staged, Turbo monorepo build, conventional commit hooks, Dependabot, release workflow.

### Changed

- **Tool Publish Auth Flow**: Updated authentication flow for publishing tools to DojOps Hub
- **CLI Banner**: Updated CLI banner and mascot display

### Fixed

- **Doc Site URL**: Corrected documentation site URL references
- **Brew Installer**: Fixed Homebrew tap installer issues
