<p align="center">
  <img src="packages/api/public/logo/official-dojops-logo.png" alt="DojOps" width="120" />
</p>

<h1 align="center">DojOps</h1>

<p align="center">
  <strong>AI-powered automation engine for infrastructure, CI/CD, and security.</strong><br />
  Describe what you need. DojOps generates it, validates it, and writes it safely.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> &nbsp;&middot;&nbsp;
  <a href="#key-capabilities">Capabilities</a> &nbsp;&middot;&nbsp;
  <a href="https://doc.dojops.ai">Docs</a> &nbsp;&middot;&nbsp;
  <a href="https://hub.dojops.ai">Skill hub</a> &nbsp;&middot;&nbsp;
  <a href="https://dojops.ai">Website</a> &nbsp;&middot;&nbsp;
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
  <img src="assets/demo.svg" alt="DojOps CLI Demo" width="800" />
</p>

---

## Why DojOps?

Writing Terraform, Kubernetes, and CI/CD configs by hand is slow. Using an LLM to generate them is fast but risky: no schema enforcement, no execution controls, no audit trail. Compliance teams can't sign off on configs they can't verify.

DojOps sits between you and your LLM provider. It constrains output to Zod schemas, validates configs with external tools (terraform validate, hadolint, kubectl dry-run), writes files through a sandbox with approval gates, and logs every action to a tamper-proof audit chain.

```
You → DojOps CLI → Agent Router → Specialist Agent → LLM Provider
                         ↓                ↓
                   Skill Engine     Schema Validation
                         ↓                ↓
                   Policy Engine → Sandbox → File Write → Audit Log
```

---

## At a glance

|                          |                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **32 specialist agents** | Terraform, Kubernetes, CI/CD, security, Docker, cloud, SRE, incident response, and more                            |
| **31 built-in skills**   | `.dops v2` manifests for GitHub Actions, Terraform, K8s, Helm, Docker, Nginx, Falco, Vault, Istio, EKS, and others |
| **7 LLM providers**      | OpenAI, Anthropic, Ollama (local), DeepSeek, Mistral, Google Gemini, GitHub Copilot                                |
| **10 security scanners** | Trivy, Gitleaks, Checkov, Semgrep, Hadolint, ShellCheck, npm/pip audit, SBOM, license scan                         |
| **12 packages**          | Modular monorepo - CLI, API, runtime, planner, executor, scanner, core, SDK, and more                              |
| **21 REST endpoints**    | Full HTTP API with web dashboard, metrics, and token tracking                                                      |
| **0 telemetry**          | Nothing leaves your machine except requests to your chosen LLM provider                                            |

---

## Quick start

```bash
# Install
npm i -g @dojops/cli

# Configure your LLM provider
dojops config

# Generate your first config
dojops "Create a Kubernetes deployment for nginx with 3 replicas"
```

<details>
<summary><strong>Other install methods</strong></summary>

```bash
# Homebrew (macOS / Linux)
brew tap dojops/tap && brew install dojops

# Shell script
curl -fsSL https://raw.githubusercontent.com/dojops/dojops/main/install.sh | sh

# Docker
docker run --rm -it ghcr.io/dojops/dojops "Create a Terraform config for S3"
```

</details>

See the [installation guide](https://doc.dojops.ai/getting-started/installation) for provider setup and configuration.

---

## How it works

```bash
# Describe what you need - the right skill and agent are selected automatically
dojops "Create a Terraform config for S3 with versioning"

# Break complex goals into dependency-aware task graphs
dojops plan "Set up CI/CD for a Node.js app with Docker deployment"

# Execute the plan with approval workflow
dojops apply plan-abc123

# Autonomous mode - plan, execute, verify, self-repair
dojops auto "Add Kubernetes HPA and PDB to my deployment"

# Scan for vulnerabilities before shipping
dojops scan

# Interactive chat session with agent routing
dojops chat

# Web dashboard + REST API
dojops serve
```

Your prompt gets routed to the right specialist agent. The LLM output is locked to a Zod schema, validated by external tools, then written to disk through the sandbox. If something fails mid-plan, `dojops apply --resume` picks up where it left off.

---

## Key capabilities

<details>
<summary><strong>32 specialist agents</strong> - automatic routing based on your prompt</summary>

Every prompt is analyzed and routed to the best-fit agent. You don't pick agents manually - the router does it based on keyword matching and confidence scoring.

| Agent                    | Domain         | What it handles                                                  |
| ------------------------ | -------------- | ---------------------------------------------------------------- |
| ops-cortex               | orchestration  | Meta-agent that coordinates across domains                       |
| terraform-specialist     | infrastructure | Terraform configs, modules, state management                     |
| kubernetes-specialist    | containers     | K8s manifests, deployments, services, RBAC                       |
| cicd-specialist          | CI/CD          | GitHub Actions, GitLab CI, Jenkins pipelines                     |
| security-auditor         | security       | Vulnerability assessment, compliance checks                      |
| docker-specialist        | containers     | Dockerfiles, Compose, multi-stage builds                         |
| cloud-architect          | cloud          | AWS, GCP, Azure architecture decisions                           |
| gitops-specialist        | gitops         | ArgoCD, Flux, GitOps workflows                                   |
| sre-specialist           | reliability    | SLOs, error budgets, reliability patterns                        |
| incident-response        | incidents      | Runbook generation, root cause analysis                          |
| cost-optimizer           | cost           | Cloud spend analysis, right-sizing                               |
| chaos-engineer           | resilience     | Chaos experiments, failure injection                             |
| platform-engineer        | platform       | Internal developer platforms, golden paths                       |
| container-security       | security       | Image scanning, runtime policies, admission control              |
| secret-management        | secrets        | Vault, sealed secrets, rotation policies                         |
| api-security-specialist  | API security   | OWASP API Top 10, rate limiting, auth patterns                   |
| policy-engine-specialist | policy         | OPA, Gatekeeper, policy-as-code                                  |
| _+ 15 more_              |                | Network, database, compliance, observability, shell, Python, ... |

Create custom agents with `dojops agents create` or drop a YAML file in `.dojops/agents/`.

</details>

<details>
<summary><strong>31 built-in skills</strong> - validated config generation for real DevOps tools</summary>

Each skill is a `.dops v2` manifest with output guidance, best practices, and optional Context7 documentation. The runtime compiles a prompt from the skill definition and your input, sends it to the LLM, and validates the output.

| Skill          | Format     | What it generates                                        |
| -------------- | ---------- | -------------------------------------------------------- |
| github-actions | YAML       | CI/CD workflows, validated by actionlint                 |
| terraform      | JSON       | HCL configs, validated by terraform validate             |
| kubernetes     | YAML       | Deployments, services, RBAC, validated by kubeconform    |
| helm           | YAML       | Charts, values files, templates                          |
| ansible        | YAML       | Playbooks, roles, inventories                            |
| docker-compose | YAML       | Multi-service compose files                              |
| dockerfile     | Dockerfile | Multi-stage builds, validated by hadolint                |
| nginx          | conf       | Server blocks, reverse proxy, TLS                        |
| prometheus     | YAML       | Alert rules, recording rules, targets                    |
| grafana        | JSON       | Dashboard definitions                                    |
| cloudformation | JSON       | AWS CloudFormation stacks                                |
| argocd         | YAML       | Applications, ApplicationSets, projects                  |
| vault          | JSON       | Policies, secret engines, auth methods                   |
| istio          | YAML       | VirtualServices, DestinationRules, AuthorizationPolicies |
| falco          | YAML       | Runtime security rules, macros, exceptions               |
| eks            | YAML       | EKS cluster configs, node groups, add-ons                |
| cert-manager   | YAML       | ClusterIssuers, Certificates, ACME config                |
| opa-gatekeeper | YAML       | ConstraintTemplates, Constraints, Rego policies          |
| flux           | YAML       | GitRepository, Kustomization, HelmRelease                |
| trivy-operator | YAML       | VulnerabilityReports, ConfigAuditReports                 |
| _+ 11 more_    |            | Pulumi, Kustomize, Crossplane, Terragrunt, Makefile, ... |

Write your own skills as `.dops v2` manifests and share them on the [DojOps Hub](https://hub.dojops.ai). Skills are auto-installed from the Hub when a prompt matches.

</details>

<details>
<summary><strong>7 LLM providers</strong> - tiered model routing across all of them</summary>

DojOps works with any of these providers. You pick one, or let the tiered router select the right model based on task complexity.

| Provider       | Fast tier        | Standard tier     | Premium tier      |
| -------------- | ---------------- | ----------------- | ----------------- |
| OpenAI         | gpt-4o-mini      | gpt-4o            | o1                |
| Anthropic      | claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-6   |
| Ollama (local) | llama3.2:3b      | llama3.1:8b       | llama3.1:70b      |
| DeepSeek       | deepseek-chat    | deepseek-chat     | deepseek-reasoner |
| Mistral        | mistral-small    | mistral-medium    | mistral-large     |
| Google Gemini  | gemini-2.0-flash | gemini-2.5-pro    | gemini-2.5-pro    |
| GitHub Copilot | gpt-4o-mini      | gpt-4o            | o1                |

Simple prompts (makefile, basic configs) get the fast tier. Complex prompts (multi-service architectures, security hardening) get the premium tier. Agent routing always uses the fast tier to keep costs low.

Override with `DOJOPS_MODEL=your-model` or `dojops config --model gpt-4o`.

</details>

<details>
<summary><strong>10 security scanners + auto-remediation</strong> - catch issues before they ship</summary>

Run `dojops scan` to check your project. Scanners run in parallel and results are aggregated into a single report.

| Scanner       | What it checks                                   |
| ------------- | ------------------------------------------------ |
| Trivy         | Container images, filesystems, IaC misconfigs    |
| Gitleaks      | Secrets, API keys, tokens in source code         |
| Checkov       | Terraform, CloudFormation, K8s policy violations |
| Semgrep       | Custom SAST rules, code patterns                 |
| Hadolint      | Dockerfile best practices                        |
| ShellCheck    | Shell script correctness and portability         |
| npm audit     | Node.js dependency vulnerabilities               |
| pip audit     | Python dependency vulnerabilities                |
| Trivy SBOM    | Software bill of materials generation            |
| Trivy License | License compliance scanning                      |

Use `dojops scan --auto-fix` to generate a remediation plan with confidence-scored fix suggestions. Pass `--yes` to apply safe fixes automatically.

</details>

<details>
<summary><strong>Task planning and execution</strong> - decompose goals into dependency graphs</summary>

`dojops plan` breaks a complex goal into a directed acyclic graph of tasks. Each task is assigned to a specialist agent and a skill. Dependencies are tracked so tasks run in the right order, with parallel execution where possible.

```bash
$ dojops plan "Set up CI/CD with Docker deployment"

  Tasks (6):
    analyze-existing-ci          [cicd-specialist]
    create-docker-build-action   [docker-specialist]  (after: analyze-existing-ci)
    create-cd-workflow           [cicd-specialist]     (after: create-docker-build-action)
    update-ci-workflow           [cicd-specialist]     (after: create-docker-build-action)
    create-docker-compose        [docker-specialist]
    update-dockerfile            [docker-specialist]

  Plan saved as plan-9219de4f
  To execute: dojops apply plan-9219de4f
```

`dojops apply` runs each task through the sandbox: generate → verify → approve → write → audit. If a task fails, fix the issue and run `dojops apply --resume` to continue from where it stopped.

</details>

<details>
<summary><strong>Autonomous mode</strong> - plan, execute, verify, and self-repair</summary>

`dojops auto` reads your project, plans changes, writes configs, runs verification, and self-repairs on failure in an iterative tool-use loop.

```bash
# Foreground - watch the agent work
dojops auto "Add Kubernetes HPA and PDB to my deployment"

# Background - check results later
dojops auto --background "Create a complete CI pipeline"
dojops auto runs abc123  # check status
```

The agent loop runs until the plan succeeds or reaches the retry limit. Each iteration: generate → validate → if errors → re-prompt with error context → retry.

</details>

<details>
<summary><strong>REST API and web dashboard</strong> - 21 endpoints over HTTP</summary>

`dojops serve` starts an Express server with API key authentication, CORS, and optional TLS.

| Method | Path            | What it does                                             |
| ------ | --------------- | -------------------------------------------------------- |
| GET    | `/api/health`   | Auth status + provider check                             |
| POST   | `/api/generate` | Agent-routed LLM generation                              |
| POST   | `/api/plan`     | Goal decomposition + optional execution                  |
| POST   | `/api/debug-ci` | CI log diagnosis                                         |
| POST   | `/api/diff`     | Infrastructure diff analysis with risk scoring           |
| POST   | `/api/scan`     | Run security scanners                                    |
| POST   | `/api/chat`     | Chat message with agent routing                          |
| POST   | `/api/auto`     | Autonomous agent (background: HTTP 202)                  |
| GET    | `/api/agents`   | List all specialist agents                               |
| GET    | `/api/metrics`  | Dashboard metrics (overview, security, audit, tokens)    |
| GET    | `/api/history`  | Execution history with audit verification                |
|        | _+ 10 more_     | Sessions, chat CRUD, metrics breakdowns, auto run status |

The web dashboard at `http://localhost:3000` shows agent usage, scan findings, execution history, and token consumption. Protect it with `DOJOPS_API_KEY` or `dojops serve credentials`.

</details>

<details>
<summary><strong>Security and audit</strong> - sandbox, policy engine, hash-chained logs</summary>

Every file write goes through the policy engine:

| Layer            | What it enforces                                             |
| ---------------- | ------------------------------------------------------------ |
| Write scope      | Only paths matching skill's `scope.write` globs are writable |
| File size limits | Rejects outputs exceeding configured limits                  |
| Approval gates   | Interactive confirmation before destructive writes           |
| Backup on update | `.bak` file created before overwriting existing configs      |
| Timeout          | Operations killed after configured timeout                   |
| Env restrictions | Only allowed environment variables are accessible            |

Every action is logged to `.dojops/audit.jsonl` as a hash-chained entry. Each record includes a SHA-256 hash of the previous record, making the chain tamper-evident. Verify integrity with `dojops history verify`.

Diff risk classification scores changes heuristically (critical paths like Dockerfile, terraform state, and secrets get higher risk scores) and suggests reviewers.

</details>

<details>
<summary><strong>MCP integration</strong> - extend with external tool servers</summary>

Connect any [Model Context Protocol](https://modelcontextprotocol.io) server to add tools to the agent loop.

```bash
# Add an MCP server
dojops mcp add my-server -- npx my-mcp-server

# Tools are auto-discovered and available in generate/plan/auto
dojops "Use my-tool to check the deployment status"
```

Supports both stdio and HTTP transports. Tools appear alongside built-in capabilities.

</details>

---

## What DojOps is not

DojOps generates and validates infrastructure configs. It does not:

- Replace your CI/CD system - it generates the configs for it
- Manage cloud state - it writes Terraform files, it doesn't run `terraform apply`
- Run in production as a service - it's a CLI and dev-time API server
- Require an internet connection beyond your LLM provider - everything else is local

---

## Architecture

```
@dojops/cli              CLI entry point, terminal UI (@clack/prompts)
@dojops/api              REST API (Express), web dashboard, 21 endpoints
@dojops/skill-registry   Skill registry, custom skill + agent discovery
@dojops/planner          Task graph decomposition, topological executor
@dojops/executor         Sandbox, policy engine, approval, audit log
@dojops/runtime          31 built-in DevOps skills (.dops v2)
@dojops/scanner          10 security scanners, auto-remediation
@dojops/mcp              MCP client manager, tool discovery
@dojops/context          Context7 documentation augmentation
@dojops/session          Chat session management, project memory
@dojops/core             LLM abstraction (7 providers), 32 specialist agents, tiered routing
@dojops/sdk              BaseSkill<T>, Zod validation, file utilities
```

```
cli -> api -> skill-registry -> runtime -> core -> sdk
          -> planner -> executor
          -> scanner
          -> mcp -> core
          -> context -> core
          -> session -> core
```

<details>
<summary><strong>How a prompt flows through the system</strong></summary>

| Step            | Package          | What happens                                                     |
| --------------- | ---------------- | ---------------------------------------------------------------- |
| 1. Parse        | `cli`            | Parse flags, detect subcommand (generate, plan, auto, scan, ...) |
| 2. Route        | `core`           | `AgentRouter` matches prompt keywords to specialist agents       |
| 3. Skill match  | `skill-registry` | SKILL_KEYWORDS map auto-selects the right `.dops` skill          |
| 4. Compile      | `runtime`        | `compilePromptV2()` merges skill template + user input + docs    |
| 5. Generate     | `core`           | LLM provider generates output, tiered model selection            |
| 6. Validate     | `runtime`        | Strip code fences, structural validation, external tool checks   |
| 7. Self-repair  | `runtime`        | If validation fails, re-prompt with errors (up to 2 retries)     |
| 8. Policy check | `executor`       | Write scope, file size, timeout, environment restrictions        |
| 9. Approve      | `cli`            | Show diff preview, prompt for confirmation                       |
| 10. Write       | `executor`       | Atomic write with `.bak` backup, restricted to allowed paths     |
| 11. Audit       | `executor`       | Hash-chained log entry in `.dojops/audit.jsonl`                  |

</details>

See [docs/architecture.md](docs/architecture.md) for the full design.

---

## Ecosystem

DojOps is more than the CLI. The organization includes several companion projects:

| Repository                                                         | What it is                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [dojops](https://github.com/dojops/dojops)                         | Main monorepo - this repo                                             |
| [dojops-hub](https://github.com/dojops/dojops-hub)                 | Skill marketplace - publish, search, install `.dops` skills           |
| [dojops-super-agent](https://github.com/dojops/dojops-super-agent) | Autonomous agent - polls Jira/GitLab tickets, runs dojops, pushes PRs |
| [dojops-connectors](https://github.com/dojops/dojops-connectors)   | Connector SDK - GitHub, GitLab, Jira integrations                     |
| [dojops-console](https://github.com/dojops/dojops-console)         | Licensing portal - license management and billing dashboard           |
| [dojops-doc](https://github.com/dojops/dojops-doc)                 | Documentation site - [doc.dojops.ai](https://doc.dojops.ai)           |
| [dojops.ai](https://github.com/dojops/dojops.ai)                   | Marketing website - [dojops.ai](https://dojops.ai)                    |
| [homebrew-tap](https://github.com/dojops/homebrew-tap)             | Homebrew formula for macOS/Linux                                      |

---

## Development

```bash
git clone https://github.com/dojops/dojops.git
cd dojops
pnpm install
pnpm build              # Build all 12 packages via Turbo
pnpm test               # Run 2,600+ tests
pnpm lint               # ESLint across all packages

# Per-package
pnpm --filter @dojops/core test

# Run locally without global install
pnpm dojops -- "Create a Terraform config for S3"
```

Requires Node.js >= 20 and pnpm >= 8.

---

## Privacy

DojOps does not collect telemetry. No project data leaves your machine except to your configured LLM provider. Generated configs, audit logs, and scan reports all stay in your local `.dojops/` directory.

When you use Ollama, nothing leaves your machine at all.

---

## Contributing

See the [contributing guide](docs/contributing.md) for setup, coding standards, and how to add skills and agents.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes with tests
4. Run `pnpm test && pnpm lint`
5. Submit a pull request

---

## License

[MIT](LICENSE)
