# CLI Reference

Complete reference for the `dojops` command-line interface.

---

## Commands

### Generation & Planning

| Command                          | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `dojops <prompt>`                | Generate DevOps config (default command)        |
| `dojops generate <prompt>`       | Explicit generation (same as default)           |
| `dojops plan <prompt>`           | Decompose goal into dependency-aware task graph |
| `dojops plan --execute <prompt>` | Plan + execute with approval workflow           |
| `dojops apply [<plan-id>]`       | Execute a saved plan                            |
| `dojops apply --verify`          | Execute with external config verification       |
| `dojops apply --resume`          | Resume a partially-failed plan                  |
| `dojops apply --dry-run`         | Preview changes without writing files           |
| `dojops validate [<plan-id>]`    | Validate plan against schemas                   |
| `dojops explain [<plan-id>]`     | LLM explains a plan in plain language           |

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
| `dojops scan --fix`          | Generate and apply LLM-powered remediation            |

### Interactive

| Command                      | Description                              |
| ---------------------------- | ---------------------------------------- |
| `dojops chat`                | Interactive multi-turn AI DevOps session |
| `dojops chat --session=NAME` | Resume or create a named session         |
| `dojops chat --resume`       | Resume the most recent session           |
| `dojops chat --agent=NAME`   | Pin conversation to a specialist agent   |

Chat supports slash commands: `/exit`, `/agent <name>`, `/plan <goal>`, `/apply`, `/scan`, `/history`, `/clear`, `/save`.

### Agents & Tools

| Command                       | Description                                      |
| ----------------------------- | ------------------------------------------------ |
| `dojops agents list`          | List all 16 specialist agents                    |
| `dojops agents info <name>`   | Show agent details and tool dependencies         |
| `dojops tools list`           | List system tools with install status            |
| `dojops tools install <name>` | Download tool into sandbox (~/.dojops/tools/)    |
| `dojops tools remove <name>`  | Remove a sandboxed tool                          |
| `dojops tools clean`          | Remove all sandbox tools                         |
| `dojops inspect <target>`     | Inspect config, policy, agents, or session state |

### History & Audit

| Command                         | Description                            |
| ------------------------------- | -------------------------------------- |
| `dojops history list`           | View execution history                 |
| `dojops history show <plan-id>` | Show plan details and per-task results |
| `dojops history verify`         | Verify audit log hash chain integrity  |
| `dojops destroy <plan-id>`      | Remove generated artifacts from a plan |
| `dojops rollback <plan-id>`     | Reverse an applied plan                |

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
| `dojops init`                       | Initialize `.dojops/` + comprehensive repo scan (11 CI, IaC, scripts, security) |
| `dojops doctor`                     | System health diagnostics + project metrics                                     |

---

## Global Options

| Option              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `--provider=NAME`   | LLM provider: `openai`, `anthropic`, `ollama`, `deepseek`, `gemini` |
| `--model=NAME`      | LLM model override                                                  |
| `--profile=NAME`    | Use named config profile                                            |
| `--output=FORMAT`   | Output: `table` (default), `json`, `yaml`                           |
| `--verbose`         | Verbose output                                                      |
| `--debug`           | Debug-level output with stack traces                                |
| `--quiet`           | Suppress non-essential output                                       |
| `--no-color`        | Disable color output                                                |
| `--non-interactive` | Disable interactive prompts                                         |
| `--yes`             | Auto-approve all confirmations (implies `--non-interactive`)        |
| `--help, -h`        | Show help message                                                   |

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
dojops apply --verify           # with external validation
dojops apply --resume --yes     # resume failed tasks, auto-approve
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

### Tool Management

```bash
# Check available tools
dojops tools list

# Install external validators
dojops tools install terraform
dojops tools install kubectl
dojops tools install hadolint

# Cleanup
dojops tools clean
```

### Administration

```bash
# System diagnostics
dojops doctor

# Browse agents
dojops agents list
dojops agents info terraform-specialist

# Audit trail
dojops history list
dojops history show plan-abc123
dojops history verify

# Start dashboard
dojops serve --port=8080

# Configuration profiles
dojops config profile create staging
dojops config profile use staging
dojops config profile list
```
