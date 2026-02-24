# Getting Started

This guide walks you through installing DojOps, configuring an LLM provider, and generating your first DevOps configuration.

---

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 8 (for development only)
- An API key from at least one supported LLM provider (or a local Ollama instance)

---

## Installation

```bash
npm i -g @dojops/cli
```

Verify the installation:

```bash
dojops --help
dojops doctor
```

---

## Provider Setup

DojOps requires an LLM provider to generate configurations. You can configure one interactively or via environment variables.

### Interactive Setup

```bash
dojops config
```

The interactive wizard will:

1. Ask you to select a provider (OpenAI, Anthropic, Ollama, DeepSeek, Gemini)
2. Prompt for your API key
3. Fetch available models from the provider's API
4. Let you pick a model with an interactive selector

### Environment Variables

Alternatively, set environment variables directly:

```bash
export DOJOPS_PROVIDER=openai          # openai | anthropic | ollama | deepseek | gemini
export OPENAI_API_KEY=sk-...        # your API key
```

See [Configuration](configuration.md) for the full list of providers, env vars, and precedence rules.

---

## First Generation

Generate a DevOps configuration with a natural language prompt:

```bash
dojops "Create a Kubernetes deployment for nginx with 3 replicas"
```

DojOps will:

1. Route your prompt to the most relevant specialist agent (in this case, `kubernetes-specialist`)
2. Generate a structured JSON response via the LLM
3. Validate the output against Zod schemas
4. Display the generated Kubernetes YAML

### More Examples

```bash
dojops "Create a Terraform config for an S3 bucket with versioning"
dojops "Write a Dockerfile for a Node.js Express app"
dojops "Set up GitHub Actions CI for a TypeScript project"
dojops "Create a Prometheus monitoring config with alerting rules"
```

---

## Project Initialization

For enterprise features (planning, execution, audit trails, metrics), initialize a project:

```bash
dojops init
```

This creates a `.dojops/` directory in your project root with:

- `context.json` — Project context (v2 schema: languages, 11 CI platforms, IaC, containers, monitoring/web servers, scripts, security configs, and a flat list of all detected DevOps file paths)
- `plans/` — Saved task graph plans
- `execution-logs/` — Execution history
- `scan-history/` — Security scan reports
- `history/audit.jsonl` — Hash-chained audit log

The `init` scanner detects:

- **CI/CD** — GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure Pipelines, AWS CodeBuild, Bitbucket, Drone, Travis CI, Tekton, Woodpecker
- **Infrastructure** — Terraform, Kubernetes, Helm, Ansible, Kustomize, Vagrant, Pulumi, CloudFormation
- **Monitoring/Web** — Prometheus, Nginx, Systemd, HAProxy, Tomcat, Apache, Caddy, Envoy
- **Scripts** — Shell scripts (`.sh`), Python scripts (`.py`), Justfile
- **Security** — `.gitignore`, `.env.example`, CODEOWNERS, SECURITY.md, Dependabot, Renovate, `.editorconfig`

---

## DevOps Quality Check

After initializing, run an LLM-powered quality check on your detected DevOps files:

```bash
dojops check
```

This reads the DevOps files listed in `context.json` and sends them to the LLM for analysis. Returns:

- **Maturity score** (0-100) — Minimal, Basic, Good, or Excellent
- **Findings** — Severity-ranked issues (critical, error, warning, info) with recommendations
- **Missing files** — Important DevOps files your project should have

Use `--output json` for machine-readable results.

---

## Planning and Execution

Decompose a complex goal into a dependency-aware task graph:

```bash
dojops plan "Set up CI/CD pipeline for a Node.js app with Docker and Kubernetes"
```

Execute the plan with an approval workflow:

```bash
dojops apply                 # Execute with interactive approval prompts
dojops apply --dry-run       # Preview changes without writing files
dojops apply --verify        # Run external validation (terraform validate, hadolint, etc.)
dojops apply --yes           # Auto-approve all operations
```

---

## Security Scanning

Scan your project for vulnerabilities, dependency issues, and IaC misconfigurations:

```bash
dojops scan                  # Run all applicable scanners
dojops scan --security       # Security scanners only (trivy, gitleaks)
dojops scan --deps           # Dependency audit only (npm, pip)
dojops scan --fix            # Generate and apply LLM-powered remediation
```

See [Security Scanning](security-scanning.md) for details on all 6 scanners.

---

## Interactive Chat

Start a multi-turn AI DevOps conversation:

```bash
dojops chat                              # New interactive session
dojops chat --session=myproject          # Resume or create a named session
dojops chat --agent=terraform            # Pin to a specialist agent
```

Chat supports slash commands: `/exit`, `/agent <name>`, `/plan <goal>`, `/apply`, `/scan`, `/history`, `/clear`, `/save`.

---

## Web Dashboard

Start the API server and web dashboard:

```bash
dojops serve                             # Start at http://localhost:3000
dojops serve --port=8080                 # Custom port
```

The dashboard provides 5 tabs for monitoring and operations:

- **Overview** — Plan/execution/scan aggregates with activity timeline
- **Security** — Scan findings, severity trends, category breakdown
- **Audit** — Hash chain integrity, command distribution, timeline
- **Agents** — Browse and search all 16 specialist agents
- **History** — Execution history with type filtering

See [Web Dashboard](dashboard.md) for the full guide.

---

## Next Steps

- **[CLI Reference](cli-reference.md)** — Full command documentation (including `dojops check`)
- **[API Reference](api-reference.md)** — REST API for programmatic access
- **[Architecture](architecture.md)** — System design overview
- **[Configuration](configuration.md)** — Advanced provider and profile setup
