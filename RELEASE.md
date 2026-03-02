# DojOps v1.0.2 Release

**Release date:** 2026-03-02

> First official public release. Versions 1.0.0 and 1.0.1 were internal testing releases.

DojOps is an enterprise-grade AI DevOps automation engine. It generates, validates, and executes infrastructure and CI/CD configurations using LLM providers — with structured output enforcement, sandboxed execution, approval workflows, hash-chained audit trails, and a rich terminal UI.

## Installation

```bash
# npm
npm i -g @dojops/cli

# Shell script
curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh

# Docker
docker run --rm -it ghcr.io/dojops/dojops "prompt"
```

## Highlights

### 6 LLM Providers

OpenAI, Anthropic, Ollama, DeepSeek, Google Gemini, and GitHub Copilot. All providers enforce structured JSON output via Zod schemas, support temperature passthrough, and dynamic model selection via `listModels()`. GitHub Copilot uses OAuth Device Flow with JWT auto-refresh and token persistence.

```bash
dojops "Create a Terraform config for S3"                    # Uses default provider
DOJOPS_PROVIDER=anthropic dojops "Create CI for Node app"    # Override provider
```

### 12 Built-in DevOps Tools

GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, and Systemd. Each tool follows a full lifecycle: **detect** existing configs, **generate** new ones via LLM, **verify** with external validators (e.g. `terraform validate`, `hadolint`), and **execute** with sandboxed file writes.

### 16 Specialist Agents

Keyword-based routing with confidence scoring across: ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, and python. Custom agents can be added via `.dojops/agents/` directory.

```bash
dojops agents list                   # List all available agents
dojops agents info terraform         # Show agent details
dojops agents create my-agent        # Scaffold a custom agent
```

### Plugin System

Declarative `plugin.yaml` manifests with JSON Schema input validation. Plugins are discovered from global (`~/.dojops/plugins/`) and project (`.dojops/plugins/`) directories. Policy enforcement via `.dojops/policy.yaml`, verification command whitelist, and path traversal prevention.

```bash
dojops tools list                    # List built-in + custom tools
dojops tools validate ./my-tool      # Validate a custom tool
dojops tools publish ./my-tool       # Publish to DojOps Hub
dojops tools install slug@1.0.0      # Install from Hub
```

### 9 Security Scanners

npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom, and semgrep. Supports `--security`, `--deps`, `--iac`, and `--sbom` scan modes with structured reports saved to `.dojops/scans/`. Delta comparison via `--compare` shows new/resolved findings between runs.

```bash
dojops scan --security               # Run security scans
dojops scan --deps                   # Dependency audit
dojops scan --iac                    # Infrastructure-as-code checks
dojops scan --sbom                   # Software bill of materials
dojops scan --compare                # Compare with previous scan
```

### Plan Lifecycle

Full `Plan -> Validate -> Apply` workflow with `TaskGraph` decomposition, topological execution, and `$ref:<taskId>` input wiring between tasks. Supports `--resume` for interrupted plans and `--replay` for deterministic mode.

```bash
dojops --plan "Create CI for Node app"           # Generate plan
dojops --execute "Create CI for Node app"        # Plan + execute
dojops --execute --yes "Create CI for Node app"  # Auto-approve
```

### Sandboxed Execution

`SafeExecutor` with configurable `ExecutionPolicy`: write permissions, allowed/denied paths, environment variable restrictions, timeout limits, and file size caps. `SandboxedFs` provides restricted file operations. Approval workflows support auto-approve, auto-deny, and callback modes.

### Hash-Chained Audit Trails

Every operation is logged as a JSONL audit entry with hash chaining for tamper detection. Entries include verification results, plugin metadata, execution context, and `systemPromptHash` tracking.

```bash
dojops history list                  # View execution history
dojops history show <id>             # Show entry details
dojops history verify                # Verify audit chain integrity
```

### CI Debugger & Infra Diff Analyzer

Paste CI logs or infrastructure diffs and get structured analysis:

```bash
dojops --debug-ci "ERROR: tsc failed..."         # Structured CI diagnosis
dojops --diff "terraform plan output..."          # Risk/cost/security analysis
```

### REST API & Web Dashboard

Express-based API with 19 endpoints covering generation, planning, debugging, scanning, chat, agents, history, and metrics. Web dashboard with dark theme and 5 tabs: Overview, Security, Audit, Agents, and History.

```bash
dojops serve                         # Start API on http://localhost:3000
dojops serve --port=8080             # Custom port
dojops serve credentials             # Generate API key
```

### Interactive Chat

Multi-turn conversation support with session persistence and automatic agent routing.

```bash
dojops chat                          # Start interactive chat
dojops chat --session <id>           # Resume a session
```

### Trust & Safety

- Structured JSON output — every LLM response validated against Zod schemas before use
- Schema validation on every tool input
- Hard file write allowlist
- Plan snapshot freezing with version pinning
- Risk classification on all tools
- Drift awareness warnings
- Atomic file writes (`.tmp` then rename) for crash safety
- No telemetry — no data leaves your machine except to your configured LLM provider

## Packages

| Package                 | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `@dojops/cli`           | CLI entry point, rich TUI via @clack/prompts                 |
| `@dojops/api`           | REST API (Express) + web dashboard, 19 endpoints             |
| `@dojops/tool-registry` | Tool registry + custom tool system + custom agent discovery  |
| `@dojops/runtime`       | 12 built-in DevOps tools                                     |
| `@dojops/scanner`       | 9 security scanners                                          |
| `@dojops/session`       | Interactive chat session management                          |
| `@dojops/planner`       | TaskGraph decomposition + topological executor               |
| `@dojops/executor`      | SafeExecutor: sandbox + policy + approval + audit            |
| `@dojops/core`          | LLM abstraction: 6 providers + 16 agents + structured output |
| `@dojops/sdk`           | BaseTool abstract class with Zod validation                  |

## Quality

- 1931 tests (Vitest)
- ESLint + Prettier
- Husky + lint-staged pre-commit hooks
- CI: GitHub Actions with Node 20/22 matrix
- Dependabot for dependency updates
- SHA-256 checksums on every release

## Links

- GitHub: https://github.com/dojops/dojops
- npm: https://www.npmjs.com/org/dojops
- Documentation: https://docs.dojops.ai
- Hub: https://hub.dojops.ai
- Website: https://dojops.ai

## What's Next

See [CHANGELOG.md](./CHANGELOG.md) for ongoing updates. Future releases will be tracked there with `[Unreleased]` items moved into versioned sections at each tag.
