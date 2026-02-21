# ODA – Next Steps Roadmap

This document defines the execution plan for ODA after the initial monorepo scaffold.

The goal is to move from foundation to production-grade DevOps agent.

---

# Phase 1 – Core Intelligence Layer

## 1. Structured Output Enforcement

- Force LLM to return strict JSON
- Introduce Zod schema validation
- Add output validation layer before tool execution
- Prevent arbitrary free-text execution

Deliverable:

- JSON contract system
- Validation middleware

---

## 2. Planner Engine (Task Graph System)

Implement:

- TaskGraph class
- Task node structure
- Execution pipeline

Example:

User Input:
"Create GitHub workflow for Node app"

Planner Output:
[
{ task: "detect_project_type" },
{ task: "generate_workflow_yaml" },
{ task: "validate_yaml" }
]

Deliverable:

- Deterministic task execution system
- Logging system for traceability

---

# Phase 2 – DevOps Tool Implementations

## 3. GitHub Actions Tool

Capabilities:

- Detect project language
- Generate workflow YAML
- Validate YAML
- Optional PR creation (future)

Deliverable:

- @odaops/tools/github
- Schema validation for workflow structure

---

## 4. Terraform Tool

Capabilities:

- Generate Terraform templates
- Validate HCL
- Run terraform plan (sandboxed)
- Output diff preview

Deliverable:

- Terraform execution wrapper
- Plan-only safe mode

---

## 5. Kubernetes Tool

Capabilities:

- Generate deployment/service YAML
- Helm chart generation
- Kustomize overlays
- Validate via kubectl --dry-run

Deliverable:

- Kubernetes adapter layer

---

# Phase 3 – Secure Execution Layer

## 6. Sandbox Engine

Implement:

- Docker-based isolated execution
- Restricted filesystem access
- Environment whitelisting
- Timeout limits

Goal:
No direct host-level execution.

---

## 7. Approval Workflow System

Before destructive operations:

- Show diff preview
- Require explicit approval
- Log execution metadata

---

# Phase 4 – Intelligence Expansion

## 8. Multi-Agent System

Agents:

- Planner Agent
- Terraform Specialist
- Kubernetes Specialist
- CI/CD Specialist
- Security Auditor

Goal:
Specialized reasoning per domain.

---

## 9. CI Debugging Mode

User pastes failing logs.

Agent:

- Analyzes logs
- Detects root cause
- Suggests fix

---

## 10. Infrastructure Diff Intelligence

Explain:

- What changed
- Cost impact
- Risk level
- Security impact

---

# Phase 5 – Platform Layer

## 11. REST API

Expose:

- /generate
- /plan
- /execute
- /explain

Goal:
Enable integration with:

- DevOps platforms
- Internal tools
- Web UI

---

## 12. Web Dashboard (Future)

Features:

- Task history
- Execution logs
- Diff visualization
- Agent trace debugging

---

# Phase 6 – CLI TUI Overhaul (DONE)

## 13. Rich Terminal UI (@clack/prompts)

Replaced all raw `console.log`/`console.error` + `readline` prompts with `@clack/prompts` components:

- **Interactive config**: `p.group()` with `p.select()`, `p.password()`, `p.text()` for `oda config`
- **Spinners**: `p.spinner()` around all async LLM calls (decompose, diagnose, analyze, route, run)
- **Styled panels**: `p.note(body, title)` for config display, CI diagnosis, infra diff analysis, task graphs, generated output, server info, approval requests
- **Semantic logs**: `p.log.success()`, `p.log.error()`, `p.log.warn()`, `p.log.info()`, `p.log.step()` replacing all `console.log`/`console.error`
- **Session framing**: `p.intro()` / `p.outro()` wrapping LLM-powered commands
- **Approval flow**: `p.note()` + `p.confirm()` with `p.isCancel()` for interactive approval
- **Help text**: Unchanged — plain `console.log` + `picocolors` for pipe/grep compatibility

Deliverable:

- Full TUI overhaul of `packages/cli/src/index.ts`
- Deleted `prompts.ts` and `prompts.test.ts` (replaced by @clack)
- All 241 tests passing

---

# Phase 7 — Enterprise Readiness

## 14. RBAC & Multi-Tenancy

- Role-based access control for plan/apply/destroy operations
- Multi-tenant project isolation
- API key scoping per tenant

## 15. Persistent Storage

- Pluggable storage backends (filesystem, SQLite, PostgreSQL)
- Migrate in-memory HistoryStore to persistent backend
- Plan and audit log archival

## 16. Observability

- OpenTelemetry instrumentation for LLM calls, tool execution, and plan lifecycle
- Prometheus metrics endpoint (`/metrics`)
- Structured logging with correlation IDs

## 17. Enterprise Integrations

- SSO (OIDC/SAML) for API authentication
- Webhook notifications for plan lifecycle events
- Slack/Teams integration for approval workflows
- Git provider integration (auto-PR for applied plans)

## 18. Resume & Recovery (DONE)

- `oda apply --resume` — skip completed tasks, retry failed
- Per-task result tracking with execution status and files created
- PARTIAL plan status for incomplete executions

## 19. Audit Integrity (DONE)

- Hash-chained JSONL audit trail (SHA-256)
- `oda history verify` for tamper detection
- Backward-compatible with legacy (pre-chain) entries

---

# Engineering Priorities

1. Safety over speed
2. Deterministic execution
3. Schema validation everywhere
4. Modular plugin architecture
5. Clear separation of orchestration vs execution

---

# Immediate Next Task (Recommended)

Implement:

1. JSON schema enforcement
2. Planner task graph
3. GitHub Actions tool

These provide visible value quickly while keeping architecture clean.
