# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DojOps (AI DevOps Automation Engine) is an enterprise-grade AI DevOps automation system. It generates, validates, and executes infrastructure and CI/CD configurations using LLM providers — with structured output enforcement, 12 built-in DevOps tools, a plugin system for custom tools, 16 built-in specialist agents + custom agents (markdown README discovery from `.dojops/agents/`), sandboxed execution, approval workflows, hash-chained audit trails, a REST API with web dashboard, and a rich terminal UI (@clack/prompts).

## Commands

```bash
pnpm build              # Build all packages via Turbo
pnpm dev                # Dev mode (no caching)
pnpm lint               # ESLint across all packages
pnpm test               # Vitest across all packages (912 tests)
pnpm format             # Prettier write
pnpm format:check       # Prettier check (CI)

# Per-package
pnpm --filter @dojops/core build
pnpm --filter @dojops/sdk build
pnpm --filter @dojops/core test

# Run CLI (after `npm link` for global `dojops`, or use `pnpm dojops --`)
dojops "Create a Terraform config for S3"
dojops --plan "Create CI for Node app"
dojops --execute "Create CI for Node app"
dojops --execute --yes "Create CI for Node app"
dojops --debug-ci "ERROR: tsc failed..."
dojops --diff "terraform plan output..."

# In-repo development (no global link needed)
pnpm dojops -- "Create a Terraform config for S3"
pnpm dojops -- --plan "Create CI for Node app"

# Run API server + dashboard
dojops serve                         # http://localhost:3000
dojops serve --port=8080
pnpm dojops -- serve                 # in-repo alternative
```

## Architecture

**Monorepo**: pnpm workspaces + Turbo. TypeScript (ES2022, CommonJS). Packages use `@dojops/*` scope.

**Package dependency flow** (top → bottom):

```
@dojops/cli            → Entry point: `dojops "prompt"` and `dojops serve`, imports factories from @dojops/api
@dojops/api            → REST API (Express) + web dashboard, factory functions, exposes all capabilities via HTTP
@dojops/tool-registry  → Tool registry + plugin system + custom agent discovery: discovers built-in + plugin tools, custom agents from .dojops/agents/
@dojops/scanner        → Security scanning engine: vulnerability, dependency, IaC, secret, and SBOM scanning (trivy, gitleaks, checkov, npm-audit, pip-audit, hadolint, shellcheck, trivy-sbom)
@dojops/session        → Interactive AI chat session management with multi-turn conversation support
@dojops/planner        → TaskGraph decomposition (LLM) + topological executor
@dojops/executor       → SafeExecutor: sandbox + policy engine + approval workflows + audit log
@dojops/tools          → 12 built-in DevOps tools: GitHub Actions, Terraform, K8s, Helm, Ansible,
                          Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd
@dojops/core           → LLM abstraction: DevOpsAgent + providers + structured output (Zod)
@dojops/sdk            → BaseTool<T> abstract class with Zod inputSchema validation + file-reader utilities
```

**API endpoints** (`@dojops/api`):

| Method | Path                    | Description                                          |
| ------ | ----------------------- | ---------------------------------------------------- |
| GET    | `/api/health`           | Provider status + metricsEnabled                     |
| POST   | `/api/generate`         | Agent-routed LLM generation                          |
| POST   | `/api/plan`             | Decompose goal + optional execution                  |
| POST   | `/api/debug-ci`         | CI log diagnosis                                     |
| POST   | `/api/diff`             | Infrastructure diff analysis                         |
| POST   | `/api/scan`             | Run security/dependency/IaC scans                    |
| POST   | `/api/chat`             | Send a chat message (with agent routing)             |
| POST   | `/api/chat/sessions`    | Create a new chat session                            |
| GET    | `/api/chat/sessions`    | List all chat sessions                               |
| GET    | `/api/chat/sessions/:id`| Get a specific chat session                          |
| DELETE | `/api/chat/sessions/:id`| Delete a chat session                                |
| GET    | `/api/agents`           | List specialist agents (built-in + custom)           |
| GET    | `/api/history`          | Execution history                                    |
| GET    | `/api/history/:id`      | Single history entry                                 |
| DELETE | `/api/history`          | Clear history                                        |
| GET    | `/api/metrics`          | Full dashboard metrics (overview + security + audit) |
| GET    | `/api/metrics/overview` | Plan/execution/scan aggregates                       |
| GET    | `/api/metrics/security` | Scan findings, severity trends                       |
| GET    | `/api/metrics/audit`    | Audit chain integrity + timeline                     |

**Key abstractions:**

- `LLMProvider` interface (`packages/core/src/llm/provider.ts`) — `generate(LLMRequest): Promise<LLMResponse>`, optional `listModels(): Promise<string[]>`, supports optional `schema` field for structured JSON output, `temperature` passthrough to all 5 providers
- `DeterministicProvider` (`packages/core/src/llm/deterministic-provider.ts`) — LLMProvider proxy that forces `temperature: 0` on every `generate()` call; used by `--replay` mode
- `parseAndValidate()` (`packages/core/src/llm/json-validator.ts`) — strips markdown fences, JSON.parse, Zod safeParse; used by all 5 providers
- `DevOpsAgent` (`packages/core/src/agent.ts`) — wraps an LLMProvider
- `AgentRouter` (`packages/core/src/agents/router.ts`) — keyword-based routing to specialist agents with confidence scoring; accepts any `SpecialistConfig[]` (built-in + custom)
- `SpecialistAgent` (`packages/core/src/agents/specialist.ts`) — domain-specific LLM agent with system prompt (16 built-in specialists: ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python + user-defined custom agents)
- `CIDebugger` (`packages/core/src/agents/ci-debugger.ts`) — analyzes CI logs, produces structured `CIDiagnosis` (error type, root cause, fixes, confidence)
- `InfraDiffAnalyzer` (`packages/core/src/agents/infra-diff.ts`) — analyzes infra diffs, produces `InfraDiffAnalysis` (risk level, cost impact, security impact, recommendations)
- `BaseTool<TInput>` (`packages/sdk/src/tool.ts`) — abstract class with Zod `inputSchema`, auto `validate()`, abstract `generate()`, optional `execute()`, optional `verify()` for external tool validation
- `VerificationResult` / `VerificationIssue` (`packages/sdk/src/tool.ts`) — structured verification output from external tools (terraform validate, hadolint, kubectl dry-run)
- `readExistingConfig()` (`packages/sdk/src/file-reader.ts`) — reads existing config files (up to 50KB) for update/enhance workflows; returns `null` for missing or oversized files
- `backupFile()` (`packages/sdk/src/file-reader.ts`) — creates `.bak` copy of existing config files before overwriting
- `parseAgentReadme()` (`packages/tool-registry/src/agent-parser.ts`) — parses structured README.md into `CustomAgentConfig` (name, domain, description, systemPrompt, keywords)
- `discoverCustomAgents()` (`packages/tool-registry/src/agent-loader.ts`) — discovers custom agents from `~/.dojops/agents/` (global) and `.dojops/agents/` (project); project overrides global by name
- `GeneratedAgentSchema` / `formatAgentReadme()` (`packages/tool-registry/src/agent-schema.ts`) — Zod schema for LLM-generated agent output + README.md formatter
- `ToolRegistry` (`packages/tool-registry/src/registry.ts`) — unified registry combining built-in + plugin tools with `getAll()` / `get(name)` / `has()` / `getToolMetadata(name)` interface
- `PluginTool` (`packages/tool-registry/src/plugin-tool.ts`) — adapter converting declarative `plugin.yaml` manifests into `DevOpsTool`-compatible objects; `systemPromptHash` getter for reproducibility tracking
- `ALLOWED_VERIFICATION_BINARIES` / `isVerificationCommandAllowed()` (`packages/tool-registry/src/plugin-tool.ts`) — whitelist of 16 allowed verification binaries enforced at runtime; `verify()` enforces 3-tier check: no command → pass, no `child_process` permission → pass (never execute), non-whitelisted → reject
- Path traversal prevention (`packages/tool-registry/src/manifest-schema.ts`) — `.refine()` on `FileEntrySchema.path` and `DetectorSchema.path` rejects `..` segments
- `createToolRegistry()` (`packages/tool-registry/src/index.ts`) — factory: loads all 12 built-in tools, discovers plugins, filters by policy, returns `ToolRegistry`
- `jsonSchemaToZod()` (`packages/tool-registry/src/json-schema-to-zod.ts`) — converts JSON Schema to runtime Zod schemas for plugin input validation
- `decompose()` (`packages/planner/src/decomposer.ts`) — LLM call → `TaskGraph` with structured output
- `PlannerExecutor` (`packages/planner/src/executor.ts`) — Kahn's topological sort, `$ref:<taskId>` input wiring, failure cascading
- `SafeExecutor` (`packages/executor/src/safe-executor.ts`) — orchestrates generate → verify → approval → execute with policy checks, timeout, and audit logging
- `ExecutionPolicy` (`packages/executor/src/types.ts`) — controls write permissions, allowed paths, denied paths, env vars, timeout, file size limits, approval requirements, `skipVerification` toggle
- `ApprovalHandler` (`packages/executor/src/approval.ts`) — interface for approval workflows; ships with `AutoApproveHandler`, `AutoDenyHandler`, `CallbackApprovalHandler`
- `createApp(deps)` (`packages/api/src/app.ts`) — Express app factory with dependency injection (`AppDependencies` interface, optional `rootDir` for metrics). Testable without `listen()`
- `HistoryStore` (`packages/api/src/store.ts`) — in-memory operation history with `add/getAll/getById/clear`
- `MetricsAggregator` (`packages/api/src/metrics/aggregator.ts`) — reads `.dojops/` data on-demand (plans, execution logs, scan reports, audit JSONL) and computes `OverviewMetrics`, `SecurityMetrics`, `AuditMetrics` with hash-chain verification
- Route factory functions (`packages/api/src/routes/*.ts`) — each returns an Express `Router`, receives dependencies via function params

**Tool pattern** (all tools follow this):

```
schemas.ts     → Zod input/output schemas (includes optional `existingContent` field)
detector.ts    → (optional) filesystem detection
generator.ts   → LLM call with structured schema → serialization (YAML/HCL); accepts optional `existingContent` to switch between "generate new" and "update existing" LLM prompts
verifier.ts    → (optional) external tool validation (terraform validate, hadolint, kubectl)
*-tool.ts      → BaseTool subclass: generate() auto-detects existing files + returns data with `isUpdate` flag, verify() validates, execute() creates .bak backup before overwriting + writes to disk
```

**Design principles** (from docs/architecture.md): No blind execution. Structured JSON outputs. Schema validation before tool execution. Idempotent operations.

## Current Status

**Implemented (Phase 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8):**

- `@dojops/core` — DevOpsAgent + 5 LLM providers (OpenAI, Anthropic, Ollama, DeepSeek, Gemini) + structured output (Zod schema on LLMRequest, JSON mode per provider, json-validator) + temperature passthrough to all providers + `DeterministicProvider` for replay mode (forces temperature=0) + dynamic model selection via `listModels()` + multi-agent system (AgentRouter, 16 SpecialistAgents) + CIDebugger + InfraDiffAnalyzer
- `@dojops/sdk` — `BaseTool<TInput>` abstract class with Zod inputSchema validation, re-exports `z`, `VerificationResult`/`VerificationIssue` types, optional `verify()` interface, `readExistingConfig()`/`backupFile()` file-reader utilities for update workflows
- `@dojops/planner` — TaskGraph/TaskNode Zod schemas (TaskNode extended with optional `toolType`/`pluginVersion`/`pluginHash`/`pluginSource`/`systemPromptHash` metadata), `decompose()` LLM decomposition, `PlannerExecutor` with topological sort + dependency resolution + `completedTaskIds` skip for resume
- `@dojops/tools` — 12 tools: GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd (each with schemas, generator, optional detector, optional verifier, tool class, tests). All tools support updating existing configs via auto-detection + `existingContent` input field + `.bak` backup before overwrite. Terraform, Dockerfile, and Kubernetes tools implement `verify()` for external validation
- `@dojops/tool-registry` — Unified tool registry combining 12 built-in tools + plugin tools discovered from `~/.dojops/plugins/` (global) and `.dojops/plugins/` (project). Plugin manifests (`plugin.yaml` + JSON Schema) converted to `DevOpsTool` at runtime. Plugin policy via `.dojops/policy.yaml`. Audit enrichment with `toolType`/`pluginSource`/`pluginVersion`/`pluginHash`/`systemPromptHash`. Plugin isolation: verification command whitelist (16 binaries), `child_process` permission enforcement, path traversal prevention on manifest file paths. Custom agent discovery: parses structured README.md from `.dojops/agents/` (project) and `~/.dojops/agents/` (global), converts to `SpecialistConfig` for `AgentRouter`
- `@dojops/executor` — `SafeExecutor` with `ExecutionPolicy` (write/path/env/timeout/size/verification restrictions), `ApprovalHandler` interface (auto-approve, auto-deny, callback), `SandboxedFs` for restricted file ops, `AuditEntry` logging with verification results + plugin metadata, `withTimeout()` for execution limits
- `@dojops/scanner` — Security scanning engine with 8 scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom), supports `--security`, `--deps`, `--iac`, `--sbom` scan modes, produces structured scan reports saved to `.dojops/scans/`, SBOM CycloneDX output saved to `.dojops/sbom/`
- `@dojops/session` — Interactive AI chat session management with multi-turn conversation support, session persistence, agent routing within chat context
- `@dojops/cli` — Full lifecycle: `init` (writes `context.json` + `context.md` + user review prompt), `plan`, `validate`, `apply` (`--dry-run`, `--resume`, `--replay`, `--yes`), `destroy`, `rollback`, `explain`, `debug ci`, `analyze diff`, `inspect` (`config`, `session`), `agents` (`list`, `info`, `create`, `remove`), `history` (`list`, `show`, `verify`), `status`/`doctor`, `config`, `auth`, `serve`, `chat`, `check`, `scan` (`--security`, `--deps`, `--iac`, `--sbom`), `tools` (including `plugins list/validate/init`). `--temperature` global flag. Deterministic replay mode (`--replay`): wraps provider in `DeterministicProvider` (temperature=0), validates provider/model/systemPromptHash match via `validateReplayIntegrity()`. Execution locking, hash-chained audit logs, plan persistence with plugin version pinning + execution context (provider/model/temperature) + `systemPromptHash` tracking, plugin integrity validation on resume (extracted to `checkPluginIntegrity()`), plugin metadata passed to SafeExecutor for audit enrichment, `resolveTemperature()` config resolution (CLI > env > config > undefined), rich TUI via `@clack/prompts`
- `@dojops/api` — REST API (Express + cors) exposing all capabilities via 19 HTTP endpoints, Zod request validation middleware, in-memory `HistoryStore`, dependency injection via `createApp(deps)`, `MetricsAggregator` for `.dojops/` data aggregation (plans, executions, scans, audit), vanilla web dashboard (dark theme, 5 tabs: Overview, Security, Audit, Agents, History), 30s auto-refresh on metrics tabs, `supertest` integration tests
- Specifications — `docs/PLUGIN_SPEC_v1.md` freezes the v1 plugin contract (manifest schema, discovery, security constraints, compatibility promise)
- Dev tooling — Vitest (912 tests), ESLint, Prettier, Husky + lint-staged, per-package tsconfig.json

## Roadmap

**Phase 1 — Core Intelligence: DONE**
**Phase 2 — More tools: DONE**
**Phase 3 — Execution: DONE**
**Phase 4 — Intelligence: DONE**
**Phase 5 — Platform: DONE** (REST API, web dashboard)
**Phase 6 — CLI TUI Overhaul: DONE** (@clack/prompts: interactive prompts, spinners, styled panels, semantic logs)
**Phase 7 — Observability & Metrics Dashboard: DONE** (MetricsAggregator, 4 metrics API endpoints, 3 dashboard tabs: Overview/Security/Audit, doctor metrics summary)
**Phase 8 — Plugin System & Tool Registry: DONE** (`@dojops/tool-registry`, plugin discovery, declarative manifests, JSON Schema to Zod, plugin policy, audit enrichment, CLI commands)
**Phase 9 — Enterprise Readiness (v2.0.0):** RBAC, persistent storage, OpenTelemetry, enterprise integrations

## Environment

Set in `.env` (see `.env.example`):

- `DOJOPS_PROVIDER`: `openai` (default) | `anthropic` | `ollama` | `deepseek` | `gemini`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / `GEMINI_API_KEY` as needed
- `DOJOPS_MODEL`: LLM model override
- `DOJOPS_TEMPERATURE`: LLM temperature override (0-2)
- `DOJOPS_API_PORT`: API server port (default `3000`)
- Ollama requires local server at `localhost:11434`

## Path Aliases

Defined in root `tsconfig.json`:

- `@dojops/core/*` → `packages/core/src/*`
- `@dojops/sdk/*` → `packages/sdk/src/*`
- `@dojops/planner/*` → `packages/planner/src/*`
- `@dojops/tools/*` → `packages/tools/src/*`
- `@dojops/executor/*` → `packages/executor/src/*`
- `@dojops/scanner/*` → `packages/scanner/src/*`
- `@dojops/session/*` → `packages/session/src/*`
- `@dojops/api/*` → `packages/api/src/*`
- `@dojops/tool-registry/*` → `packages/tool-registry/src/*`
