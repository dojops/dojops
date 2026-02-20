# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ODA (Open DevOps Agent) is an agentic DevOps system that automates infrastructure and CI/CD tasks using LLM providers. Structured output enforcement, a task planner, five DevOps tools, and a sandboxed execution engine with approval workflows are implemented.

## Commands

```bash
pnpm build              # Build all packages via Turbo
pnpm dev                # Dev mode (no caching)
pnpm lint               # ESLint across all packages
pnpm test               # Vitest across all packages (75 tests)
pnpm format             # Prettier write
pnpm format:check       # Prettier check (CI)

# Per-package
pnpm --filter @oda/core build
pnpm --filter @oda/cli dev
pnpm --filter @oda/sdk build
pnpm --filter @oda/core test

# Run CLI
ODA_PROVIDER=ollama pnpm --filter @oda/cli dev <prompt>
ODA_PROVIDER=ollama pnpm --filter @oda/cli dev --plan "Create CI for Node app"
ODA_PROVIDER=ollama pnpm --filter @oda/cli dev --execute "Create CI for Node app"
ODA_PROVIDER=ollama pnpm --filter @oda/cli dev --execute --yes "Create CI for Node app"
```

## Architecture

**Monorepo**: pnpm workspaces + Turbo. TypeScript (ES2022, CommonJS). Packages use `@oda/*` scope.

**Package dependency flow** (top → bottom):

```
@oda/cli          → Entry point, --plan/--execute/--yes flags
@oda/planner      → TaskGraph decomposition (LLM) + topological executor
@oda/executor     → SafeExecutor: sandbox + policy engine + approval workflows + audit log
@oda/tools        → DevOps tools: GitHub Actions, Terraform, Kubernetes, Helm, Ansible
@oda/core         → LLM abstraction: DevOpsAgent + providers + structured output (Zod)
@oda/sdk          → BaseTool<T> abstract class with Zod inputSchema validation
@oda/api          → (planned) REST API layer
```

**Key abstractions:**

- `LLMProvider` interface (`packages/core/src/llm/provider.ts`) — `generate(LLMRequest): Promise<LLMResponse>`, supports optional `schema` field for structured JSON output
- `parseAndValidate()` (`packages/core/src/llm/json-validator.ts`) — strips markdown fences, JSON.parse, Zod safeParse; used by all 3 providers
- `DevOpsAgent` (`packages/core/src/agent.ts`) — wraps an LLMProvider
- `BaseTool<TInput>` (`packages/sdk/src/tool.ts`) — abstract class with Zod `inputSchema`, auto `validate()`, abstract `generate()`, optional `execute()`
- `decompose()` (`packages/planner/src/decomposer.ts`) — LLM call → `TaskGraph` with structured output
- `PlannerExecutor` (`packages/planner/src/executor.ts`) — Kahn's topological sort, `$ref:<taskId>` input wiring, failure cascading
- `SafeExecutor` (`packages/executor/src/safe-executor.ts`) — orchestrates generate → approval → execute with policy checks, timeout, and audit logging
- `ExecutionPolicy` (`packages/executor/src/types.ts`) — controls write permissions, allowed paths, denied paths, env vars, timeout, file size limits, approval requirements
- `ApprovalHandler` (`packages/executor/src/approval.ts`) — interface for approval workflows; ships with `AutoApproveHandler`, `AutoDenyHandler`, `CallbackApprovalHandler`

**Tool pattern** (all tools follow this):

```
schemas.ts     → Zod input/output schemas
detector.ts    → (optional) filesystem detection
generator.ts   → LLM call with structured schema → serialization (YAML/HCL)
*-tool.ts      → BaseTool subclass: generate() returns data, execute() writes to disk
```

**Design principles** (from ARCHITECTURE.md): No blind execution. Structured JSON outputs. Schema validation before tool execution. Idempotent operations.

## Current Status

**Implemented (Phase 1 + 2 + 3):**

- `@oda/core` — DevOpsAgent + 3 LLM providers (OpenAI, Anthropic, Ollama) + structured output (Zod schema on LLMRequest, JSON mode per provider, json-validator)
- `@oda/sdk` — `BaseTool<TInput>` abstract class with Zod inputSchema validation, re-exports `z`
- `@oda/planner` — TaskGraph/TaskNode Zod schemas, `decompose()` LLM decomposition, `PlannerExecutor` with topological sort + dependency resolution
- `@oda/tools` — 5 tools: GitHub Actions, Terraform, Kubernetes, Helm, Ansible (each with schemas, generator, detector/tool, tests)
- `@oda/executor` — `SafeExecutor` with `ExecutionPolicy` (write/path/env/timeout/size restrictions), `ApprovalHandler` interface (auto-approve, auto-deny, callback), `SandboxedFs` for restricted file ops, `AuditEntry` logging, `withTimeout()` for execution limits
- `@oda/cli` — CLI with `--plan` (generate only), `--execute` (generate + sandboxed execute with approval), `--yes` (auto-approve)
- Dev tooling — Vitest (75 tests), ESLint, Prettier, Husky + lint-staged, per-package tsconfig.json

**Empty scaffolding:** `@oda/api`

## Roadmap (from NEXT_STEPS.md)

**Phase 1 — Core Intelligence: DONE**
**Phase 2 — More tools: DONE**
**Phase 3 — Execution: DONE**
**Phase 4 — Intelligence (next):** Multi-agent system, CI debugging, infra diff
**Phase 5 — Platform:** REST API, web dashboard

## Environment

Set in `.env` (see `.env.example`):

- `ODA_PROVIDER`: `openai` (default) | `anthropic` | `ollama`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as needed
- Ollama requires local server at `localhost:11434`

## Path Aliases

Defined in root `tsconfig.json`:

- `@oda/core/*` → `packages/core/src/*`
- `@oda/sdk/*` → `packages/sdk/src/*`
- `@oda/planner/*` → `packages/planner/src/*`
- `@oda/tools/*` → `packages/tools/src/*`
- `@oda/executor/*` → `packages/executor/src/*`
