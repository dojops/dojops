# CLI Reference

Complete reference for the `dojops` command-line interface.

---

## Commands

### Generation & Planning

| Command                           | Description                                                 |
| --------------------------------- | ----------------------------------------------------------- |
| `dojops <prompt>`                 | Generate DevOps config (default command)                    |
| `dojops generate <prompt>`        | Explicit generation (same as default)                       |
| `dojops plan <prompt>`            | Decompose goal into dependency-aware task graph             |
| `dojops plan --execute <prompt>`  | Plan + execute with approval workflow                       |
| `dojops apply [<plan-id>]`        | Execute a saved plan                                        |
| `dojops apply --skip-verify`      | Skip external config verification (on by default)           |
| `dojops apply --allow-all-paths`  | Bypass DevOps file write allowlist                          |
| `dojops apply --resume`           | Resume a partially-failed plan                              |
| `dojops apply --replay`           | Deterministic replay: temp=0, validate env match            |
| `dojops apply --dry-run`          | Preview changes without writing files                       |
| `dojops apply --force`            | Skip git dirty check, HIGH risk gate, and replay validation |
| `dojops apply --task <id>`        | Run only a single task from the plan                        |
| `dojops apply --timeout <sec>`    | Per-task timeout in seconds (default: 60)                   |
| `dojops apply --retry`            | Retry failed tasks when used with `--resume`                |
| `dojops apply --install-packages` | Run package manager install after successful apply          |
| `dojops validate [<plan-id>]`     | Validate plan against schemas                               |
| `dojops explain [<plan-id>]`      | LLM explains a plan in plain language                       |

### Diagnostics & Analysis

| Command                            | Description                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `dojops check`                     | LLM-powered DevOps config quality check (score 0-100)                                          |
| `dojops check --output json`       | Output check report as JSON                                                                    |
| `dojops check --fix`               | Auto-remediate HIGH/CRITICAL findings via LLM                                                  |
| `dojops check provider`            | Test LLM provider connectivity and list models                                                 |
| `dojops debug ci <log>`            | Diagnose CI/CD log failures (root cause, fixes)                                                |
| `dojops analyze diff --file`       | Analyze infrastructure diff (risk, cost, security)                                             |
| `dojops scan`                      | Security scan: vulnerabilities, deps, IaC, secrets                                             |
| `dojops scan --security`           | Run security scanners only (trivy, gitleaks)                                                   |
| `dojops scan --deps`               | Run dependency audit only (npm, pip)                                                           |
| `dojops scan --iac`                | Run IaC scanners only (checkov, hadolint)                                                      |
| `dojops scan --sbom`               | Generate SBOM (CycloneDX) with hash tracking                                                   |
| `dojops scan --license`            | Run license compliance scanners (trivy-license)                                                |
| `dojops scan --fix`                | Generate and apply LLM-powered remediation                                                     |
| `dojops scan --compare`            | Compare findings with previous scan report                                                     |
| `dojops scan --target <dir>`       | Scan a different directory                                                                     |
| `dojops scan --fail-on <sev>`      | Set severity threshold for non-zero exit (CRITICAL, HIGH, MEDIUM, LOW)                         |
| `dojops review [files...]`         | Run DevSecOps review pipeline (auto-discovers DevOps files, runs validation tools, LLM review) |
| `dojops review --no-auto-discover` | Skip auto-discovery, review only explicitly listed files                                       |
| `dojops review --context7`         | Enable Context7 documentation augmentation for review                                          |

### Interactive

| Command                            | Description                                            |
| ---------------------------------- | ------------------------------------------------------ |
| `dojops chat`                      | Interactive multi-turn AI DevOps session               |
| `dojops chat --session=NAME`       | Resume or create a named session                       |
| `dojops chat --resume`             | Resume the most recent session                         |
| `dojops chat --agent=NAME`         | Pin conversation to a specialist agent                 |
| `dojops chat --message=TEXT`       | Send a single message and exit (scriptable, also `-m`) |
| `dojops chat export`               | Export all sessions as markdown                        |
| `dojops chat export <id>`          | Export a specific session                              |
| `dojops chat export --format=json` | Export as JSON instead of markdown                     |
| `dojops chat export --output=FILE` | Write export to a file instead of stdout               |

Chat supports slash commands: `/exit`, `/agent <name>`, `/plan <goal>`, `/apply`, `/scan`, `/history`, `/clear`, `/save`.

### Agents & Modules

| Command                           | Description                                                |
| --------------------------------- | ---------------------------------------------------------- |
| `dojops agents list`              | List all agents (built-in + custom)                        |
| `dojops agents info <name>`       | Show agent details (supports partial names)                |
| `dojops agents create <desc>`     | Create a custom agent (LLM-generated)                      |
| `dojops agents create --manual`   | Create a custom agent interactively                        |
| `dojops agents remove <name>`     | Remove a custom agent                                      |
| `dojops modules load <path>`      | Copy a local tool.yaml module into `.dojops/tools/`        |
| `dojops modules list`             | List discovered custom modules (global + project)          |
| `dojops modules validate <path>`  | Validate a custom module manifest                          |
| `dojops modules init <name>`      | Scaffold a v2 `.dops` module (with optional AI generation) |
| `dojops modules publish <file>`   | Publish a .dops module to the DojOps Hub                   |
| `dojops modules install <name>`   | Install a .dops module from the DojOps Hub                 |
| `dojops modules search <query>`   | Search the DojOps Hub for modules                          |
| `dojops modules dev <path.dops>`  | Validate a .dops file with live feedback                   |
| `dojops modules dev --watch`      | Watch mode — re-validate on file changes                   |
| `dojops toolchain list`           | List system toolchain binaries with install status         |
| `dojops toolchain install <name>` | Download binary into toolchain (~/.dojops/toolchain/)      |
| `dojops toolchain remove <name>`  | Remove a toolchain binary                                  |
| `dojops toolchain clean`          | Remove all toolchain binaries                              |
| `dojops inspect [<target>]`       | Inspect config and/or session state (default: both)        |
| `dojops verify`                   | Verify audit log hash chain integrity (standalone)         |

### History & Audit

| Command                         | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `dojops history list`           | View execution history                                                |
| `dojops history show <plan-id>` | Show plan details and per-task results                                |
| `dojops history verify`         | Verify audit log hash chain integrity                                 |
| `dojops history audit`          | List audit log entries                                                |
| `dojops history repair`         | Repair broken audit log hash chain                                    |
| `dojops clean [<plan-id>]`      | Remove generated artifacts from a plan                                |
| `dojops destroy <plan-id>`      | Deprecated alias for `clean`                                          |
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

| Command                                       | Description                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dojops config`                               | Configure provider, model, tokens (interactive)                                                                                                   |
| `dojops config show`                          | Display current configuration                                                                                                                     |
| `dojops config profile create NAME`           | Save current config as a named profile                                                                                                            |
| `dojops config profile use NAME`              | Switch to a named profile                                                                                                                         |
| `dojops config profile list`                  | List all profiles                                                                                                                                 |
| `dojops config get <key>`                     | Get a specific config value (tokens are masked)                                                                                                   |
| `dojops config set <key> <value>`             | Set a config value (supports dot notation, e.g. `tokens.openai`)                                                                                  |
| `dojops config delete <key>`                  | Delete a config key                                                                                                                               |
| `dojops config validate`                      | Validate config values and file permissions                                                                                                       |
| `dojops auth login`                           | Authenticate with LLM provider                                                                                                                    |
| `dojops auth status`                          | Show saved tokens and default provider                                                                                                            |
| `dojops serve [--port=N]`                     | Start API server + web dashboard                                                                                                                  |
| `dojops serve --no-auth`                      | Start server without API key authentication (local dev only)                                                                                      |
| `dojops serve --tls-cert=PATH --tls-key=PATH` | Enable HTTPS/TLS on the API server                                                                                                                |
| `dojops serve credentials`                    | Generate API key for dashboard/API authentication                                                                                                 |
| `dojops init`                                 | Initialize `.dojops/` + comprehensive repo scan (11 CI, IaC, scripts, security)                                                                   |
| `dojops status`                               | System health diagnostics + project metrics (alias: `doctor`, `--fix` to auto-repair). Always shows installed tools regardless of project context |
| `dojops upgrade`                              | Check for and install CLI updates (`--check` for check-only)                                                                                      |

### Scheduled Jobs

| Command                                  | Description                                         |
| ---------------------------------------- | --------------------------------------------------- |
| `dojops cron`                            | Show cron usage                                     |
| `dojops cron add "<schedule>" <command>` | Add a scheduled DojOps job (cron expression + args) |
| `dojops cron list`                       | List all scheduled jobs                             |
| `dojops cron remove <job-id>`            | Remove a scheduled job                              |

---

## Global Options

| Option                     | Description                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `--provider=NAME`          | LLM provider: `openai`, `anthropic`, `ollama`, `deepseek`, `gemini`, `github-copilot` |
| `--model=NAME`             | LLM model override                                                                    |
| `--temperature=N`          | LLM temperature (0-2) for deterministic reproducibility                               |
| `--fallback-provider=NAME` | Fallback LLM provider (used when primary fails)                                       |
| `--profile=NAME`           | Use named config profile                                                              |
| `--module=NAME`            | Force a specific module for `generate`, `plan`, or `apply` (bypasses agent routing)   |
| `--file, -f FILE`          | Read prompt from a file (`.md`, `.txt`); combinable with inline prompt                |
| `--agent=NAME`             | Force a specific agent for `generate` (bypasses keyword routing)                      |
| `--timeout=MS`             | Global timeout in milliseconds                                                        |
| `--output=FORMAT`          | Output: `table` (default), `json`, `yaml`                                             |
| `--raw`                    | Output raw LLM response text only (no formatting)                                     |
| `--verbose`                | Verbose output                                                                        |
| `--debug`                  | Debug-level output with stack traces                                                  |
| `--quiet`                  | Suppress non-essential output                                                         |
| `--no-color`               | Disable color output                                                                  |
| `--non-interactive`        | Disable interactive prompts                                                           |
| `--yes`                    | Auto-approve all confirmations (implies `--non-interactive`)                          |
| `--version, -V`            | Show version number                                                                   |
| `--help, -h`               | Show help message                                                                     |

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

## Lifecycle Hooks

DojOps supports lifecycle hooks — shell commands that run at specific events during CLI operations. Configure hooks in `.dojops/hooks.json`:

```json
{
  "hooks": {
    "pre-generate": { "command": "echo 'Starting generation...'" },
    "post-generate": { "command": "./scripts/lint-output.sh" },
    "pre-plan": { "command": "git stash" },
    "post-plan": [
      { "command": "echo 'Plan complete'" },
      { "command": "./notify.sh", "continueOnError": true }
    ],
    "on-error": { "command": "./scripts/alert-failure.sh" }
  }
}
```

### Hook Events

| Event           | When it runs                | Abort on failure |
| --------------- | --------------------------- | ---------------- |
| `pre-generate`  | Before LLM generation       | Yes              |
| `post-generate` | After successful generation | No               |
| `pre-plan`      | Before plan decomposition   | Yes              |
| `post-plan`     | After plan completion       | No               |
| `pre-execute`   | Before execution/apply      | Yes              |
| `post-execute`  | After execution completes   | No               |
| `pre-scan`      | Before security scanning    | Yes              |
| `post-scan`     | After scan completes        | No               |
| `on-error`      | When any operation fails    | No               |

### Hook Environment Variables

Hooks receive context via environment variables:

| Variable             | Description                       |
| -------------------- | --------------------------------- |
| `DOJOPS_HOOK_EVENT`  | The event name (e.g. `pre-plan`)  |
| `DOJOPS_HOOK_ROOT`   | Project root directory            |
| `DOJOPS_HOOK_AGENT`  | Active agent name (if applicable) |
| `DOJOPS_HOOK_OUTPUT` | Output file path (if applicable)  |
| `DOJOPS_HOOK_PROMPT` | The user prompt (if applicable)   |
| `DOJOPS_HOOK_ERROR`  | Error message (`on-error` only)   |

Pre-hooks abort the operation on failure by default. Set `"continueOnError": true` to override. Post-hooks and `on-error` hooks continue by default.

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

# Force a specific module (bypass agent routing)
dojops --module=terraform "Create an S3 bucket with versioning"
dojops --module=kubernetes "Create a deployment for nginx"
```

### File-Based Prompts

```bash
# Read prompt from a file
dojops --file requirements.md
dojops -f spec.txt

# Combine inline prompt with file content (inline provides context, file provides details)
dojops --file infrastructure-spec.md "Use Terraform with AWS"
dojops plan -f cicd-requirements.txt "Target GitHub Actions"
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
dojops apply --resume --retry   # resume + retry failed tasks
dojops apply --replay           # deterministic: temp=0, validate env match
dojops apply --replay --yes     # force replay despite mismatches

# Force a specific module for planning or execution
dojops --module=terraform plan "Set up S3 with CloudFront"
dojops apply plan-abc --module=terraform   # only run terraform tasks from plan
```

### Diagnostics

```bash
# Debug CI failures
dojops debug ci "ERROR: tsc failed with exit code 1..."
dojops debug ci "npm ERR! ERESOLVE unable to resolve dependency tree"

# Analyze infrastructure diffs (--file recommended for multiline)
dojops analyze diff --file plan.diff
terraform plan | dojops analyze diff
dojops explain last
```

### DevOps Quality Check

```bash
# Analyze detected DevOps files for quality, security, and best practices
dojops check

# Machine-readable output
dojops check --output json

# Auto-remediate findings
dojops check --fix
dojops check --fix --yes        # auto-approve remediation

# Test provider connectivity
dojops check provider
dojops check provider --output json
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
dojops scan --license           # license compliance check

# Compare with previous scan
dojops scan --compare

# Auto-remediation
dojops scan --fix --yes

# Scan a different directory
dojops scan --target /path/to/project

# Fail CI on severity threshold
dojops scan --fail-on MEDIUM
```

### DevSecOps Review

```bash
# Review all auto-discovered DevOps files in the project
dojops review

# Review specific files only
dojops review Dockerfile docker-compose.yml

# Skip auto-discovery, review only listed files
dojops review --no-auto-discover Dockerfile

# Enable Context7 docs for richer review
dojops review --context7
```

### Interactive Chat

```bash
# Start a new session
dojops chat

# Named session with agent pinning
dojops chat --session=infra --agent=terraform

# Resume the most recent session
dojops chat --resume

# Single message (non-interactive, scriptable)
dojops chat --message "What tools are missing in this project?"
dojops chat -m "Explain the CI pipeline" --output json
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

### Custom Module Management

```bash
# List discovered custom modules (global + project)
dojops modules list

# Search the DojOps Hub for modules
dojops modules search docker
dojops modules search terraform --limit 5
dojops modules search k8s --output json

# Scaffold a new v2 .dops module (uses AI when provider is configured)
dojops modules init my-module

# Scaffold with legacy v1 format
dojops modules init my-module --legacy

# Validate a custom module
dojops modules validate my-module

# Publish a module to DojOps Hub (requires DOJOPS_HUB_TOKEN)
dojops modules publish my-module.dops --changelog "Initial release"

# Install a module from DojOps Hub
dojops modules install nginx-config
dojops modules install nginx-config --version 1.0.0 --global
```

### Hub Publishing Setup

Publishing modules to the [DojOps Hub](https://hub.dojops.ai) requires an API token:

```bash
# 1. Sign in at hub.dojops.ai → Settings → API Tokens
# 2. Generate a token (format: dojops_<40-hex-chars>)
# 3. Set the environment variable:
export DOJOPS_HUB_TOKEN="dojops_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

# Publish a module
dojops modules publish my-module.dops

# Publish with changelog
dojops modules publish my-module.dops --changelog "v1.1.0: Added Redis support"

# Install from hub (no token required)
dojops modules install my-module
dojops modules install my-module --version 1.0.0 --global
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
dojops status                          # canonical command
dojops doctor                          # alias

# Browse agents (partial names supported: terraform, docker, security, etc.)
dojops agents list
dojops agents info terraform            # matches terraform-specialist
dojops agents info security             # matches security-auditor

# Create custom agents
dojops agents create "an SRE specialist for incident response"
dojops agents create --manual
dojops agents remove sre-specialist

# Audit trail
dojops history list
dojops history show plan-abc123
dojops history verify
dojops history audit                   # view audit log entries
dojops history repair                  # repair broken audit chain

# Start dashboard
dojops serve --port=8080

# Generate API credentials and start with auth
dojops serve credentials             # generates key, saves to ~/.dojops/server.json
dojops serve                         # auto-loads key from server.json

# Start without authentication (local development only)
dojops serve --no-auth

# Enable HTTPS/TLS
dojops serve --tls-cert=cert.pem --tls-key=key.pem

# Configuration profiles
dojops config profile create staging
dojops config profile use staging
dojops config profile list

# Check for updates
dojops upgrade --check

# Upgrade to latest version
dojops upgrade

# Upgrade without confirmation
dojops upgrade --yes
```

### Config Management

```bash
dojops config get defaultProvider        # Read a value
dojops config set defaultProvider ollama  # Set a value
dojops config set tokens.openai sk-xxx   # Set nested value
dojops config delete tokens.deepseek     # Remove a key
dojops config validate                   # Check config health
```

### Scheduled Jobs

```bash
dojops cron add "0 2 * * *" plan "backup terraform"   # Schedule nightly plan
dojops cron add "*/30 * * * *" scan --security         # Scan every 30 min
dojops cron list                                        # View all jobs
dojops cron remove job-abc123                           # Remove a job
```

### Module Development

```bash
dojops modules dev my-tool.dops          # Validate a module
dojops modules dev my-tool.dops --watch  # Watch mode
```

### Chat Export

```bash
dojops chat export                       # Export all sessions as markdown
dojops chat export session-123           # Export specific session
dojops chat export --format=json         # Export as JSON
dojops chat export --output=chat.md      # Save to file
```
