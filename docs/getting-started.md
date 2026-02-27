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

DojOps requires an LLM provider to generate configurations. You have three options:

### Quick Setup (recommended)

```bash
# Add your first provider — automatically becomes the default
dojops provider add openai --token sk-...
```

### Interactive Wizard

```bash
dojops config
```

The interactive wizard will:

1. Ask you to select a provider (OpenAI, Anthropic, Ollama, DeepSeek, Gemini)
2. Prompt for your API key
3. Fetch available models from the provider's API
4. Let you pick a model with an interactive selector
5. Offer to configure additional providers

### Environment Variables

Alternatively, set environment variables directly:

```bash
export DOJOPS_PROVIDER=openai          # openai | anthropic | ollama | deepseek | gemini
export OPENAI_API_KEY=sk-...        # your API key
```

### Multi-Provider Setup

You can configure multiple providers and switch between them:

```bash
# Add providers
dojops provider add openai --token sk-...
dojops provider add anthropic --token sk-ant-...

# Switch between them
dojops provider switch                 # Interactive picker
dojops provider default anthropic      # Direct switch

# List all providers
dojops provider
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

### Updating Existing Configs

DojOps can also update existing configurations. When a config file already exists, DojOps automatically reads it and tells the LLM to preserve and enhance it rather than starting from scratch:

```bash
# If you already have a GitHub Actions workflow, DojOps detects it and enhances it
dojops "Add caching to the GitHub Actions workflow"

# Same for Terraform, Docker Compose, etc.
dojops "Add a Redis service to docker-compose"
dojops "Add an S3 bucket to the existing Terraform config"
```

A `.bak` backup is created before overwriting any existing file.

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
dojops apply                 # Execute with interactive approval + verification
dojops apply --dry-run       # Preview changes without writing files
dojops apply --skip-verify   # Skip external validation (runs by default)
dojops apply --force         # Skip git dirty working tree check
dojops apply --yes           # Auto-approve all operations
dojops apply --replay        # Deterministic replay: temp=0, validate environment match
```

---

## Security Scanning

Scan your project for vulnerabilities, dependency issues, and IaC misconfigurations:

```bash
dojops scan                  # Run all applicable scanners
dojops scan --security       # Security scanners only (trivy, gitleaks)
dojops scan --deps           # Dependency audit only (npm, pip)
dojops scan --sbom           # Generate SBOM (CycloneDX) with hash tracking
dojops scan --fix            # Generate and apply LLM-powered remediation
```

See [Security Scanning](security-scanning.md) for details on all 8 scanners.

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

## Extending with Custom Tools

DojOps supports custom tools via a declarative tool system. Create a custom tool by dropping a `tool.yaml` manifest + JSON Schema into `~/.dojops/tools/` (global) or `.dojops/tools/` (project-scoped):

```bash
# Scaffold a new custom tool
dojops tools init my-tool

# List discovered custom tools
dojops tools list

# Validate a tool manifest
dojops tools validate .dojops/tools/my-tool/
```

Custom tools are automatically available to all commands — the Planner includes them in capabilities, the Executor validates and runs them, and the audit trail tracks their usage.

See [DevOps Tools — Custom Tool System](tools.md#custom-tool-system) for the full guide.

---

## Custom Agents

DojOps supports custom specialist agents. Create an agent by placing a structured `README.md` in `.dojops/agents/<name>/` (project-scoped) or `~/.dojops/agents/<name>/` (global):

```bash
# LLM-generated (recommended) — describe what you want and the LLM creates the agent
dojops agents create "an SRE specialist for incident response and reliability"

# Manual creation via interactive prompts
dojops agents create --manual

# List all agents (built-in + custom)
dojops agents list

# View agent details
dojops agents info sre-specialist

# Remove a custom agent
dojops agents remove sre-specialist
```

Custom agents are automatically discovered and routable — they participate in keyword-based routing just like built-in agents. Project agents override global agents with the same name.

---

## Next Steps

- **[CLI Reference](cli-reference.md)** — Full command documentation (including `dojops check`)
- **[API Reference](api-reference.md)** — REST API for programmatic access
- **[Architecture](architecture.md)** — System design overview
- **[Configuration](configuration.md)** — Advanced provider and profile setup
