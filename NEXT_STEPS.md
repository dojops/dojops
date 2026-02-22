# ODA – Roadmap

This document tracks ODA's development from initial scaffold to production-grade DevOps agent.

---

# v1.0.0 — Shipped

All seven phases are complete. ODA v1.0.0 ships with 12 DevOps tools, 16 specialist agents, sandboxed execution, approval workflows, hash-chained audit trails, a REST API with web dashboard, observability metrics, and a rich terminal UI.

---

## Phase 1 — Core Intelligence Layer (DONE)

- **Structured output enforcement** — LLM responses constrained to JSON via provider-native modes (OpenAI `response_format`, Anthropic prefill, Ollama `format`, DeepSeek `response_format`, Gemini `responseMimeType`)
- **5 LLM providers** — OpenAI, Anthropic, Ollama, DeepSeek (OpenAI-compatible), Google Gemini (`@google/genai`)
- **Dynamic model selection** — `oda config` fetches available models from provider APIs via `listModels()` for interactive selection
- **Zod schema validation** — Every tool input and LLM output validated with Zod schemas via `parseAndValidate()`
- **Planner engine** — `TaskGraph` decomposition via LLM, `PlannerExecutor` with Kahn's topological sort, `$ref:<taskId>` input wiring, failure cascading, `completedTaskIds` for resume

---

## Phase 2 — DevOps Tools (DONE)

12 tools covering CI/CD, infrastructure-as-code, containers, monitoring, and system services:

| Tool           | Detector | Serialization                |
| -------------- | -------- | ---------------------------- |
| GitHub Actions | Yes      | js-yaml                      |
| Terraform      | Yes      | Custom HCL builder           |
| Kubernetes     | No       | js-yaml                      |
| Helm           | No       | js-yaml                      |
| Ansible        | No       | js-yaml                      |
| Docker Compose | Yes      | js-yaml                      |
| Dockerfile     | Yes      | Custom string builder        |
| Nginx          | No       | Custom string builder        |
| Makefile       | Yes      | Custom string builder (tabs) |
| GitLab CI      | Yes      | js-yaml                      |
| Prometheus     | No       | js-yaml                      |
| Systemd        | No       | Custom string builder (INI)  |

All tools follow the `BaseTool<T>` pattern: `schemas.ts` → `detector.ts` (optional) → `generator.ts` → `*-tool.ts` → tests.

---

## Phase 3 — Secure Execution Layer (DONE)

- **SafeExecutor** — generate → approval → execute pipeline with policy checks, timeout, and audit logging
- **ExecutionPolicy** — write permissions, allowed/denied paths, env vars, timeout, file size limits
- **ApprovalHandler** — auto-approve, auto-deny, or interactive callback with diff preview
- **SandboxedFs** — path-restricted file operations with per-file audit logging
- **Resume & recovery** — `oda apply --resume` skips completed tasks, retries failed ones
- **Hash-chained audit trail** — SHA-256 hash-chained JSONL with tamper detection via `oda history verify`
- **Execution locking** — PID-based lock files prevent concurrent mutations

---

## Phase 4 — Intelligence Expansion (DONE)

- **16 specialist agents** — ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python
- **AgentRouter** — keyword-based routing with confidence scoring and fallback
- **CI Debugger** — paste CI logs, get structured diagnosis (error type, root cause, fixes, confidence)
- **InfraDiffAnalyzer** — risk level, cost impact, security implications, rollback complexity, recommendations

---

## Phase 5 — Platform Layer (DONE)

- **REST API** — 9 Express endpoints exposing all capabilities over HTTP with Zod request validation
- **Web dashboard** — dark-themed SPA with 6 tabs (Generate, Plan, Debug CI, Infra Diff, Agents, History)
- **In-memory HistoryStore** — operation history with add/getAll/getById/clear

---

## Phase 6 — CLI TUI Overhaul (DONE)

- **@clack/prompts** — interactive arrow-key prompts, spinners, styled note panels, semantic log levels
- **Full command set** — init, plan, validate, apply, destroy, rollback, explain, debug ci, analyze diff, inspect, agents, history, doctor, config, auth, serve
- **Session framing** — intro/outro wrapping, approval flow with confirm/cancel

---

## Phase 7 — Observability & Metrics Dashboard (DONE)

- **MetricsAggregator** — reads `.oda/` data on-demand: plans, execution logs, scan reports, audit JSONL
- **4 metrics API endpoints** — `GET /api/metrics` (full), `/overview`, `/security`, `/audit`
- **Overview tab** — total plans, success rate, avg execution time, critical issues, recent activity, most used commands, failure reasons
- **Security tab** — severity breakdown bar, findings trend chart (CSS-only bars), top issues table, scan history
- **Audit tab** — hash-chain integrity badge (valid/invalid), status breakdown, command distribution, timeline
- **Auto-refresh** — observability tabs poll every 30 seconds with visual indicator
- **Doctor enhancement** — `oda doctor` shows plans count, success rate, scan count, audit chain integrity
- **Health endpoint** — includes `metricsEnabled: boolean` flag
- **25 new tests** — aggregator unit tests (17) + route integration tests (8)

---

# v2.0.0 — Planned

## Phase 8 — Enterprise Readiness

### RBAC & Multi-Tenancy

- Role-based access control for plan/apply/destroy operations
- Multi-tenant project isolation
- API key scoping per tenant

### Persistent Storage

- Pluggable storage backends (filesystem → SQLite → PostgreSQL)
- Migrate in-memory HistoryStore to persistent backend
- Plan and audit log archival with retention policies

### Observability

- OpenTelemetry instrumentation for LLM calls, tool execution, and plan lifecycle
- Prometheus metrics endpoint (`/metrics`)
- Structured logging with correlation IDs

### Enterprise Integrations

- SSO (OIDC/SAML) for API authentication
- Webhook notifications for plan lifecycle events
- Slack/Teams integration for approval workflows
- Git provider integration (auto-PR for applied plans)

### Advanced Execution

- Docker-based isolated execution environments
- Cost estimation engine for infrastructure changes
- Drift detection for applied configurations
- Cloud provider SDK integrations (AWS, GCP, Azure)

---

# Engineering Principles

1. Safety over speed
2. Deterministic execution
3. Schema validation everywhere
4. Modular plugin architecture
5. Clear separation of orchestration vs execution
