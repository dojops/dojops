# CLI Reference

Complete reference for the `dojops` command-line interface.

---

## Commands

### Generation & Planning

| Command                          | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| `dojops <prompt>`                | Generate DevOps config (default command)          |
| `dojops generate <prompt>`       | Explicit generation (same as default)             |
| `dojops plan <prompt>`           | Decompose goal into dependency-aware task graph   |
| `dojops plan --execute <prompt>` | Plan + execute with approval workflow             |
| `dojops apply [<plan-id>]`       | Execute a saved plan                              |
| `dojops apply --skip-verify`     | Skip external config verification (on by default) |
| `dojops apply --allow-all-paths` | Bypass DevOps file write allowlist                |
| `dojops apply --resume`          | Resume a partially-failed plan                    |
| `dojops apply --replay`          | Deterministic replay: temp=0, validate env match  |
| `dojops apply --dry-run`         | Preview changes without writing files             |
| `dojops validate [<plan-id>]`    | Validate plan against schemas                     |
| `dojops explain [<plan-id>]`     | LLM explains a plan in plain language             |

### Diagnostics & Analysis

| Command                      | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `dojops check`               | LLM-powered DevOps config quality check (score 0-100) |
| `dojops check --output json` | Output check report as JSON                           |
| `dojops debug ci <log>`      | Diagnose CI/CD log failures (root cause, fixes)       |
| `dojops analyze diff <diff>` | Analyze infrastructure diff (risk, cost, security)    |
| `dojops scan`                | Security scan: vulnerabilities, deps, IaC, secrets    |
| `dojops scan --security`     | Run security scanners only (trivy, gitleaks)          |
| `dojops scan --deps`         | Run dependency audit only (npm, pip)                  |
| `dojops scan --iac`          | Run IaC scanners only (checkov, hadolint)             |
| `dojops scan --sbom`         | Generate SBOM (CycloneDX) with hash tracking          |
| `dojops scan --fix`          | Generate and apply LLM-powered remediation            |
| `dojops scan --compare`      | Compare findings with previous scan report            |

### Interactive

| Command                      | Description                              |
| ---------------------------- | ---------------------------------------- |
| `dojops chat`                | Interactive multi-turn AI DevOps session |
| `dojops chat --session=NAME` | Resume or create a named session         |
| `dojops chat --resume`       | Resume the most recent session           |
| `dojops chat --agent=NAME`   | Pin conversation to a specialist agent   |

Chat supports slash commands: `/exit`, `/agent <name>`, `/plan <goal>`, `/apply`, `/scan`, `/history`, `/clear`, `/save`.

### Agents & Tools

| Command                           | Description                                           |
| --------------------------------- | ----------------------------------------------------- |
| `dojops agents list`              | List all agents (built-in + custom)                   |
| `dojops agents info <name>`       | Show agent details and tool dependencies              |
| `dojops agents create <desc>`     | Create a custom agent (LLM-generated)                 |
| `dojops agents create --manual`   | Create a custom agent interactively                   |
| `dojops agents remove <name>`     | Remove a custom agent                                 |
| `dojops tools list`               | List discovered custom tools (global + project)       |
| `dojops tools validate <path>`    | Validate a custom tool manifest                       |
| `dojops tools init <name>`        | Scaffold a new custom tool with template files        |
| `dojops tools publish <file>`     | Publish a .dops tool to the DojOps Hub                |
| `dojops tools install <name>`     | Install a .dops tool from the DojOps Hub              |
| `dojops toolchain list`           | List system toolchain binaries with install status    |
| `dojops toolchain install <name>` | Download binary into toolchain (~/.dojops/toolchain/) |
| `dojops toolchain remove <name>`  | Remove a toolchain binary                             |
| `dojops toolchain clean`          | Remove all toolchain binaries                         |
| `dojops inspect <target>`         | Inspect config or session state                       |

### History & Audit

| Command                         | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `dojops history list`           | View execution history                                                |
| `dojops history show <plan-id>` | Show plan details and per-task results                                |
| `dojops history verify`         | Verify audit log hash chain integrity                                 |
| `dojops destroy <plan-id>`      | Remove generated artifacts from a plan                                |
| `dojops rollback <plan-id>`     | Reverse an applied plan (delete created files + restore .bak backups) |

### Provider Management

| Command                                    | Description                                    |
| ------------------------------------------ | ---------------------------------------------- |
| `dojops provider`                          | List all providers with status (alias: `list`) |
| `dojops provider add <name> [--token KEY]` | Add/configure a provider token                 |
| `dojops provider remove <name>`            | Remove a provider token                        |
| `dojops provider default <name>`           | Set the default provider                       |
| `dojops provider switch`                   | Interactive picker to switch default provider  |
| `dojops provider --as-default <name>`      | Set default provider (shortcut)                |
| `dojops provider list --output json`       | List providers as JSON                         |

### Configuration & Server

| Command                             | Description                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `dojops config`                     | Configure provider, model, tokens (interactive)                                 |
| `dojops config show`                | Display current configuration                                                   |
| `dojops config profile create NAME` | Save current config as a named profile                                          |
| `dojops config profile use NAME`    | Switch to a named profile                                                       |
| `dojops config profile list`        | List all profiles                                                               |
| `dojops auth login`                 | Authenticate with LLM provider                                                  |
| `dojops auth status`                | Show saved tokens and default provider                                          |
| `dojops serve [--port=N]`           | Start API server + web dashboard                                                |
| `dojops serve credentials`          | Generate API key for dashboard/API authentication                               |
| `dojops init`                       | Initialize `.dojops/` + comprehensive repo scan (11 CI, IaC, scripts, security) |
| `dojops doctor`                     | System health diagnostics + project metrics                                     |

---

## Global Options

| Option              | Description                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--provider=NAME`   | LLM provider: `openai`, `anthropic`, `ollama`, `deepseek`, `gemini`, `github-copilot` |
| `--model=NAME`      | LLM model override                                                                    |
| `--temperature=N`   | LLM temperature (0-2) for deterministic reproducibility                               |
| `--profile=NAME`    | Use named config profile                                                              |
| `--output=FORMAT`   | Output: `table` (default), `json`, `yaml`                                             |
| `--verbose`         | Verbose output                                                                        |
| `--debug`           | Debug-level output with stack traces                                                  |
| `--quiet`           | Suppress non-essential output                                                         |
| `--no-color`        | Disable color output                                                                  |
| `--non-interactive` | Disable interactive prompts                                                           |
| `--yes`             | Auto-approve all confirmations (implies `--non-interactive`)                          |
| `--help, -h`        | Show help message                                                                     |

---

## Exit Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | Success                              |
| 1    | General error                        |
| 2    | Validation error                     |
| 3    | Approval required                    |
| 4    | Lock conflict (concurrent operation) |
| 5    | No `.dojops/` project                |
| 6    | HIGH security findings detected      |
| 7    | CRITICAL security findings detected  |

---

## Examples

### Generating Configs

```bash
# Generate with automatic agent routing
dojops "Create a Terraform config for S3 with versioning"
dojops "Write a Kubernetes deployment for nginx with 3 replicas"
dojops "Set up monitoring with Prometheus and alerting rules"
dojops "Create a multi-stage Dockerfile for a Go application"

# Update existing configs (auto-detects existing files, creates .bak backup)
dojops "Add caching to the GitHub Actions workflow"
dojops "Add a Redis service to docker-compose"
dojops "Add an S3 bucket to the existing Terraform config"

# Override provider/model for a single command
dojops --provider=anthropic "Create a Helm chart for Redis"
dojops --model=gpt-4o "Design a VPC with public and private subnets"
```

### Planning and Execution

```bash
# Decompose a complex goal into tasks
dojops plan "Set up CI/CD for a Node.js app with Docker and Kubernetes"

# Plan and execute immediately
dojops plan --execute --yes "Create CI pipeline for a Python project"

# Execute a saved plan
dojops apply
dojops apply --dry-run          # preview only
dojops apply --skip-verify      # skip external validation (on by default)
dojops apply --force            # skip git dirty working tree check
dojops apply --allow-all-paths  # bypass DevOps file write allowlist
dojops apply --resume --yes     # resume failed tasks, auto-approve
dojops apply --replay           # deterministic: temp=0, validate env match
dojops apply --replay --yes     # force replay despite mismatches
```

### Diagnostics

```bash
# Debug CI failures
dojops debug ci "ERROR: tsc failed with exit code 1..."
dojops debug ci "npm ERR! ERESOLVE unable to resolve dependency tree"

# Analyze infrastructure diffs
dojops analyze diff "terraform plan output..."
dojops explain last
```

### DevOps Quality Check

```bash
# Analyze detected DevOps files for quality, security, and best practices
dojops check

# Machine-readable output
dojops check --output json
```

### Security Scanning

```bash
# Full project scan
dojops scan

# Targeted scans
dojops scan --security          # trivy + gitleaks
dojops scan --deps              # npm-audit + pip-audit
dojops scan --iac               # checkov + hadolint
dojops scan --sbom              # generate SBOM with hash tracking

# Compare with previous scan
dojops scan --compare

# Auto-remediation
dojops scan --fix --yes
```

### Interactive Chat

```bash
# Start a new session
dojops chat

# Named session with agent pinning
dojops chat --session=infra --agent=terraform

# Resume the most recent session
dojops chat --resume
```

### Toolchain Management

```bash
# Check available toolchain binaries
dojops toolchain list

# Install external validators
dojops toolchain install terraform
dojops toolchain install kubectl
dojops toolchain install hadolint

# Cleanup
dojops toolchain clean
```

### Custom Tool Management

```bash
# List discovered custom tools (global + project)
dojops tools list

# Scaffold a new custom tool
dojops tools init my-tool

# Validate a custom tool manifest
dojops tools validate .dojops/tools/my-tool/

# Publish a tool to DojOps Hub (requires DOJOPS_HUB_TOKEN)
dojops tools publish my-tool.dops --changelog "Initial release"

# Install a tool from DojOps Hub
dojops tools install nginx-config
dojops tools install nginx-config --version 1.0.0 --global
```

### Hub Publishing Setup

Publishing tools to the [DojOps Hub](https://hub.dojops.ai) requires an API token:

```bash
# 1. Sign in at hub.dojops.ai → Settings → API Tokens
# 2. Generate a token (format: dojops_<40-hex-chars>)
# 3. Set the environment variable:
export DOJOPS_HUB_TOKEN="dojops_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

# Publish a tool
dojops tools publish my-tool.dops

# Publish with changelog
dojops tools publish my-tool.dops --changelog "v1.1.0: Added Redis support"

# Install from hub (no token required)
dojops tools install my-tool
dojops tools install my-tool --version 1.0.0 --global
```

The CLI sends the token as a `Bearer` header. Tokens can be managed (created, viewed, revoked) from the Hub Settings page at `/settings/tokens`. See the [tools documentation](tools.md#hub-integration) for the full publish/install flow.

### Provider Management

```bash
# List all providers with status
dojops provider
dojops provider list --output json

# Add providers
dojops provider add openai --token sk-...
dojops provider add anthropic --token sk-ant-...

# Switch default provider
dojops provider switch                 # interactive picker
dojops provider default anthropic      # direct
dojops provider --as-default openai    # shortcut flag

# Remove a provider
dojops provider remove deepseek
```

### Administration

```bash
# System diagnostics
dojops doctor

# Browse agents
dojops agents list
dojops agents info terraform-specialist

# Create custom agents
dojops agents create "an SRE specialist for incident response"
dojops agents create --manual
dojops agents remove sre-specialist

# Audit trail
dojops history list
dojops history show plan-abc123
dojops history verify

# Start dashboard
dojops serve --port=8080

# Generate API credentials and start with auth
dojops serve credentials             # generates key, saves to ~/.dojops/server.json
dojops serve                         # auto-loads key from server.json

# Configuration profiles
dojops config profile create staging
dojops config profile use staging
dojops config profile list
```
