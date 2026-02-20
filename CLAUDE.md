# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ODA (Open DevOps Agent) is an agentic DevOps system that automates infrastructure and CI/CD tasks using LLM providers. Structured output enforcement, a task planner, five DevOps tools, a sandboxed execution engine with approval workflows, a multi-agent system, CI debugging, infra diff intelligence, a REST API, and a web dashboard are implemented.

## Commands

```bash
pnpm build              # Build all packages via Turbo
pnpm dev                # Dev mode (no caching)
pnpm lint               # ESLint across all packages
pnpm test               # Vitest across all packages (139 tests)
pnpm format             # Prettier write
pnpm format:check       # Prettier check (CI)

# Per-package
pnpm --filter @oda/core build
pnpm --filter @oda/sdk build
pnpm --filter @oda/core test

# Run CLI (after `npm link` for global `oda`, or use `pnpm oda --`)
oda "Create a Terraform config for S3"
oda --plan "Create CI for Node app"
oda --execute "Create CI for Node app"
oda --execute --yes "Create CI for Node app"
oda --debug-ci "ERROR: tsc failed..."
oda --diff "terraform plan output..."

# In-repo development (no global link needed)
pnpm oda -- "Create a Terraform config for S3"
pnpm oda -- --plan "Create CI for Node app"

# Run API server + dashboard
oda serve                         # http://localhost:3000
oda serve --port=8080
pnpm oda -- serve                 # in-repo alternative
```

## Architecture

**Monorepo**: pnpm workspaces + Turbo. TypeScript (ES2022, CommonJS). Packages use `@oda/*` scope.

**Package dependency flow** (top → bottom):

```
@oda/cli          → Entry point: `oda "prompt"` and `oda serve`, imports factories from @oda/api
@oda/api          → REST API (Express) + web dashboard, factory functions, exposes all capabilities via HTTP
@oda/planner      → TaskGraph decomposition (LLM) + topological executor
@oda/executor     → SafeExecutor: sandbox + policy engine + approval workflows + audit log
@oda/tools        → DevOps tools: GitHub Actions, Terraform, Kubernetes, Helm, Ansible
@oda/core         → LLM abstraction: DevOpsAgent + providers + structured output (Zod)
@oda/sdk          → BaseTool<T> abstract class with Zod inputSchema validation
```

**API endpoints** (`@oda/api`):

| Method | Path               | Description                         |
| ------ | ------------------ | ----------------------------------- |
| GET    | `/api/health`      | Provider status                     |
| POST   | `/api/generate`    | Agent-routed LLM generation         |
| POST   | `/api/plan`        | Decompose goal + optional execution |
| POST   | `/api/debug-ci`    | CI log diagnosis                    |
| POST   | `/api/diff`        | Infrastructure diff analysis        |
| GET    | `/api/agents`      | List specialist agents              |
| GET    | `/api/history`     | Execution history                   |
| GET    | `/api/history/:id` | Single history entry                |
| DELETE | `/api/history`     | Clear history                       |

**Key abstractions:**

- `LLMProvider` interface (`packages/core/src/llm/provider.ts`) — `generate(LLMRequest): Promise<LLMResponse>`, supports optional `schema` field for structured JSON output
- `parseAndValidate()` (`packages/core/src/llm/json-validator.ts`) — strips markdown fences, JSON.parse, Zod safeParse; used by all 3 providers
- `DevOpsAgent` (`packages/core/src/agent.ts`) — wraps an LLMProvider
- `AgentRouter` (`packages/core/src/agents/router.ts`) — keyword-based routing to specialist agents with confidence scoring
- `SpecialistAgent` (`packages/core/src/agents/specialist.ts`) — domain-specific LLM agent with system prompt (5 specialists: planner, terraform, kubernetes, cicd, security)
- `CIDebugger` (`packages/core/src/agents/ci-debugger.ts`) — analyzes CI logs, produces structured `CIDiagnosis` (error type, root cause, fixes, confidence)
- `InfraDiffAnalyzer` (`packages/core/src/agents/infra-diff.ts`) — analyzes infra diffs, produces `InfraDiffAnalysis` (risk level, cost impact, security impact, recommendations)
- `BaseTool<TInput>` (`packages/sdk/src/tool.ts`) — abstract class with Zod `inputSchema`, auto `validate()`, abstract `generate()`, optional `execute()`
- `decompose()` (`packages/planner/src/decomposer.ts`) — LLM call → `TaskGraph` with structured output
- `PlannerExecutor` (`packages/planner/src/executor.ts`) — Kahn's topological sort, `$ref:<taskId>` input wiring, failure cascading
- `SafeExecutor` (`packages/executor/src/safe-executor.ts`) — orchestrates generate → approval → execute with policy checks, timeout, and audit logging
- `ExecutionPolicy` (`packages/executor/src/types.ts`) — controls write permissions, allowed paths, denied paths, env vars, timeout, file size limits, approval requirements
- `ApprovalHandler` (`packages/executor/src/approval.ts`) — interface for approval workflows; ships with `AutoApproveHandler`, `AutoDenyHandler`, `CallbackApprovalHandler`
- `createApp(deps)` (`packages/api/src/app.ts`) — Express app factory with dependency injection (`AppDependencies` interface). Testable without `listen()`
- `HistoryStore` (`packages/api/src/store.ts`) — in-memory operation history with `add/getAll/getById/clear`
- Route factory functions (`packages/api/src/routes/*.ts`) — each returns an Express `Router`, receives dependencies via function params

**Tool pattern** (all tools follow this):

```
schemas.ts     → Zod input/output schemas
detector.ts    → (optional) filesystem detection
generator.ts   → LLM call with structured schema → serialization (YAML/HCL)
*-tool.ts      → BaseTool subclass: generate() returns data, execute() writes to disk
```

**Design principles** (from ARCHITECTURE.md): No blind execution. Structured JSON outputs. Schema validation before tool execution. Idempotent operations.

## Current Status

**Implemented (Phase 1 + 2 + 3 + 4 + 5):**

- `@oda/core` — DevOpsAgent + 3 LLM providers (OpenAI, Anthropic, Ollama) + structured output (Zod schema on LLMRequest, JSON mode per provider, json-validator) + multi-agent system (AgentRouter, 5 SpecialistAgents) + CIDebugger + InfraDiffAnalyzer
- `@oda/sdk` — `BaseTool<TInput>` abstract class with Zod inputSchema validation, re-exports `z`
- `@oda/planner` — TaskGraph/TaskNode Zod schemas, `decompose()` LLM decomposition, `PlannerExecutor` with topological sort + dependency resolution
- `@oda/tools` — 5 tools: GitHub Actions, Terraform, Kubernetes, Helm, Ansible (each with schemas, generator, detector/tool, tests)
- `@oda/executor` — `SafeExecutor` with `ExecutionPolicy` (write/path/env/timeout/size restrictions), `ApprovalHandler` interface (auto-approve, auto-deny, callback), `SandboxedFs` for restricted file ops, `AuditEntry` logging, `withTimeout()` for execution limits
- `@oda/cli` — CLI with `--plan` (generate only), `--execute` (generate + sandboxed execute with approval), `--yes` (auto-approve), `--debug-ci` (CI log diagnosis), `--diff` (infra diff analysis), multi-agent routing in default mode
- `@oda/api` — REST API (Express + cors) exposing all capabilities via 9 HTTP endpoints, Zod request validation middleware, in-memory `HistoryStore`, dependency injection via `createApp(deps)`, vanilla web dashboard (dark theme, 6 tabs: Generate, Plan, Debug CI, Infra Diff, Agents, History), `supertest` integration tests
- Dev tooling — Vitest (139 tests), ESLint, Prettier, Husky + lint-staged, per-package tsconfig.json

## Roadmap (from NEXT_STEPS.md)

**Phase 1 — Core Intelligence: DONE**
**Phase 2 — More tools: DONE**
**Phase 3 — Execution: DONE**
**Phase 4 — Intelligence: DONE**
**Phase 5 — Platform: DONE** (REST API, web dashboard)

## Environment

Set in `.env` (see `.env.example`):

- `ODA_PROVIDER`: `openai` (default) | `anthropic` | `ollama`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as needed
- `ODA_API_PORT`: API server port (default `3000`)
- Ollama requires local server at `localhost:11434`

## Path Aliases

Defined in root `tsconfig.json`:

- `@oda/core/*` → `packages/core/src/*`
- `@oda/sdk/*` → `packages/sdk/src/*`
- `@oda/planner/*` → `packages/planner/src/*`
- `@oda/tools/*` → `packages/tools/src/*`
- `@oda/executor/*` → `packages/executor/src/*`
- `@oda/api/*` → `packages/api/src/*`
