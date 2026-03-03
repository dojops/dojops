# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.5] - 2026-03-03

### Added

- **`.dops` v2 Format**: New `.dops v2` module format that replaces `input.fields` and `output` blocks with a `context` block containing `technology`, `fileFormat`, `outputGuidance`, `bestPractices`, and `context7Libraries`. The LLM generates raw file content directly (no JSON→serialize step), producing cleaner output with less schema overhead
- **`DopsRuntimeV2`**: New runtime class (`packages/runtime/src/runtime.ts`) for processing v2 modules — compiles prompts with `compilePromptV2()`, strips code fences from raw LLM output via `stripCodeFences()`, and integrates with Context7 via the `DocProvider` interface
- **All 12 Built-in Tools Converted to v2**: All built-in `.dops` modules in `packages/runtime/modules/` now use v2 format with `context` blocks, best practices, and Context7 library references
- **Version-Detecting Parsers**: `parseDopsStringAny()` and `parseDopsFileAny()` (`packages/runtime/src/parser.ts`) automatically detect the `dops` version field and route to `DopsRuntime` (v1) or `DopsRuntimeV2` (v2)
- **v2 Prompt Variables**: New template variables for v2 prompts — `{outputGuidance}` (from `context.outputGuidance`), `{bestPractices}` (numbered list from `context.bestPractices`), `{context7Docs}` (documentation fetched at runtime via Context7), `{projectContext}` (project scanner context)
- **`DocProvider` Interface**: Duck-typed interface (`{ augmentPrompt() }`) for Context7 documentation augmentation in v2 tools, injected into `DopsRuntimeV2` at construction time
- **Hub v1/v2 Backward Compatibility**: Hub database extended with `dopsVersion` and `contextBlock` columns on the `Version` model, supporting both v1 and v2 `.dops` format uploads and downloads
- **93 New v2 Tests**: Comprehensive test coverage for v2 parsing, prompt compilation, raw content generation, code fence stripping, Context7 integration, and version detection (total: 1931 → 2140 tests)
- **Context7 Documentation Augmentation (`@dojops/context`)**: New package that fetches up-to-date documentation from [Context7](https://context7.com) and injects it into LLM system prompts during generation — improving output accuracy even when the LLM's training data is stale. Covers all 12 built-in tool domains and specialist agent domains via static library mapping. Opt-in via `DOJOPS_CONTEXT_ENABLED=true`.
- **Context7 REST Client**: Native `fetch()` client for Context7 API (`/v2/libs/search` + `/v2/context`) with configurable timeout (10s default), optional API key auth (`DOJOPS_CONTEXT7_API_KEY`), and in-memory TTL cache (5 min default, configurable via `DOJOPS_CONTEXT_CACHE_TTL`)
- **Documentation-Augmented Agent Routing**: `SpecialistAgent.run()` and `runWithHistory()` now accept an optional duck-typed `docAugmenter` and prepend a `## Reference Documentation` section to the system prompt with current syntax references
- **Documentation-Augmented Tool Generation**: `DopsRuntime.generate()` augments the compiled system prompt with Context7 docs after `compilePrompt()`, giving all 12 built-in tools and user `.dops` files access to current documentation
- **Augmenter Threading**: `createRouter()` and `createToolRegistry()` factories accept an optional `docAugmenter` param; CLI creates the augmenter in `generate`, `chat`, and `serve` commands when enabled
- **Schema Injection for LLM Providers**: All 6 providers (OpenAI, Anthropic, DeepSeek, Gemini, GitHub Copilot, Ollama) now embed the full JSON Schema in the system prompt via `augmentSystemPrompt()`, dramatically improving structured output accuracy — especially for providers without native schema enforcement
- **Scanner Install Hints**: `dojops scan` now displays per-scanner install instructions (brew/apt/pip/URL) when scanners are skipped due to missing binaries
- **npm-audit Without Lockfile**: `dojops scan --deps` now generates a temporary lockfile when only `package.json` exists, enabling dependency auditing without a committed lockfile
- **`--provider` Flag for `serve`**: `dojops serve --provider=<name>` overrides the LLM provider for the API server session
- **Plan Retry (`--retry`)**: `dojops apply --resume --retry` now retries failed tasks (previously only skipped completed tasks)
- **`check --fix` Auto-Remediation**: `dojops check --fix` sends HIGH/CRITICAL findings to the LLM for auto-remediation and generates file patches with approval
- **Scanner Timeout Handling**: Scanners now respect a per-scanner timeout (default 60s, configurable via `DOJOPS_SCAN_TIMEOUT_MS`); timed-out scanners are reported in `scannersSkipped`
- **`config profile use default`**: Reset to base configuration after switching to a named profile
- **Available Plans in `clean`**: `dojops clean` without a plan ID now lists available plans with status and date to help users pick the right one

### Changed

- **Tool Generation Model**: Built-in tools now generate raw file content directly via LLM instead of structured JSON objects that required serialization. This produces more natural output and eliminates the JSON→serialize step
- **`docker-compose` Risk Level**: Changed from `MEDIUM` to `LOW` — Compose changes are local development configurations
- **Tool Registry v2 Routing**: `ToolRegistry` now uses `parseDopsFileAny()` for version detection and routes v2 modules to `DopsRuntimeV2` via `isV2Module()` check
- **`serve` Provider Resolution**: `dojops serve` now uses `resolveProvider()` to correctly respect `DOJOPS_PROVIDER` env var (previously ignored it)
- **`--no-auth` Safety Warning**: `dojops serve --no-auth` now displays a prominent warning: "API authentication disabled. Do not expose to untrusted networks."
- **Apply Exit Codes**: `dojops apply` now exits with code 1 on FAILURE or PARTIAL status instead of 0, enabling CI integration
- **Apply Plan Auto-Selection**: `dojops apply` now shows which plan was auto-selected ("Using session plan: ..." or "Using latest plan: ...")
- **`config show` Active Profile**: `dojops config show` now displays the active profile name in the title when a non-default profile is active
- **`config show` Effective Provider**: `dojops config show` displays effective provider with env var override details when `DOJOPS_PROVIDER` differs from config
- **Inspect Error Messages**: `dojops inspect` now shows distinct error messages for no subcommand vs unknown subcommand, with usage examples
- **Session ID Error**: API chat session lookup now returns generic "Session not found" (404) instead of leaking implementation details about ID format
- **Chat Send Error Handling**: API `POST /api/chat` now returns 500 with error message on `session.send()` failure instead of crashing the route

### Fixed

- **`chat --agent` Validation**: `dojops chat --agent=<invalid>` now correctly rejects unknown agent names and lists available agents — previously silently fell through to default routing because `--agent` was consumed by the global parser but `chat.ts` tried to re-extract it from args
- **`tools init` Flag Parsing**: `dojops tools init --yes` no longer treats `--yes` as the tool name; flags are now filtered from positional arguments before extracting the tool name
- **`toolchain install` Exit Code**: `dojops toolchain install` now exits with code 1 on failure (e.g., missing `unzip`) instead of silently exiting 0
- **Schema Transform Crash**: `augmentSystemPrompt()` no longer crashes when a Zod schema contains `.transform()` or `.pipe()` — gracefully falls back to generic JSON instruction
- **API 404 JSON Response**: Unmatched `/api/*` routes now return `{"error":"Not found"}` (JSON) instead of Express default HTML error page
- **`serve` Provider Bug**: `dojops serve` now correctly uses `resolveProvider()` instead of ignoring the `DOJOPS_PROVIDER` environment variable
- **`--no-auth` Flag Override**: `dojops serve --no-auth` now correctly disables auth even when `server.json` or env var sets an API key
- **API Version Header**: `X-API-Version: 1` header is now correctly set on `/api/v1/health` endpoint (middleware registration order fix)
- **`doctor`/`status` Provider Display**: Now uses `resolveProvider()` to show effective provider including env var overrides
- **`auth status` Provider Display**: Now uses `resolveProvider()` to show effective provider including env var overrides
- **`init` Empty Directory**: Skips LLM enrichment when no project files are detected, avoiding wasted API calls
- **Scan No-Scanners Warning**: Displays a prominent warning when all scanners are skipped instead of silently showing empty results
- **Apply Task Status Wording**: PlannerExecutor now reports tasks as "generated" instead of "completed" to avoid confusion with the full lifecycle status

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
