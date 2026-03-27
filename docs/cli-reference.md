# CLI Reference

Complete reference for the `dojops` command-line interface.

---

## Commands

### Generation & Planning

| Command                           | Description                                                     |
| --------------------------------- | --------------------------------------------------------------- |
| `dojops <prompt>`                 | Generate DevOps config (default command)                        |
| `dojops generate <prompt>`        | Explicit generation (same as default)                           |
| `dojops plan <prompt>`            | Decompose goal into dependency-aware task graph                 |
| `dojops plan --voice`             | Use voice input as the plan prompt (requires whisper.cpp + sox) |
| `dojops plan --execute <prompt>`  | Plan + execute with approval workflow                           |
| `dojops apply [<plan-id>]`        | Execute a saved plan                                            |
| `dojops apply --skip-verify`      | Skip external config verification (on by default)               |
| `dojops apply --allow-all-paths`  | Bypass DevOps file write allowlist                              |
| `dojops apply --resume`           | Resume a partially-failed plan                                  |
| `dojops apply --replay`           | Deterministic replay: temp=0, validate env match                |
| `dojops apply --dry-run`          | Preview changes without writing files                           |
| `dojops apply --force`            | Skip git dirty check, HIGH risk gate, and replay validation     |
| `dojops apply --task <id>`        | Run only a single task from the plan                            |
| `dojops apply --timeout <sec>`    | Per-task timeout in seconds (default: 60)                       |
| `dojops apply --retry`            | Retry failed tasks when used with `--resume`                    |
| `dojops apply --parallel <n>`     | Max concurrent tasks per wave (default: 3, semaphore pool)      |
| `dojops apply --install-packages` | Run package manager install after successful apply              |
| `dojops validate [<plan-id>]`     | Validate plan against schemas                                   |
| `dojops explain [<plan-id>]`      | LLM explains a plan in plain language                           |

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

### Infrastructure Analysis

| Command                                | Description                                    |
| -------------------------------------- | ---------------------------------------------- |
| `dojops cost [directory]`              | Estimate infrastructure costs using Infracost  |
| `dojops cost --output json`            | Output cost estimate as JSON                   |
| `dojops cost --currency USD\|EUR\|GBP` | Set currency for cost estimates (default: USD) |
| `dojops drift`                         | Detect infrastructure drift                    |
| `dojops drift --terraform`             | Check Terraform state drift                    |
| `dojops drift --kubernetes`            | Check Kubernetes resource drift                |
| `dojops drift --output json`           | Output drift report as JSON                    |
| `dojops drift --terraform-dir <path>`  | Specify Terraform root module directory        |
| `dojops drift --kube-context <ctx>`    | Specify Kubernetes context                     |
| `dojops drift --namespace <ns>`        | Limit Kubernetes drift check to a namespace    |
| `dojops fix-deps`                      | Auto-remediate vulnerable dependencies         |
| `dojops fix-deps --dry-run`            | Preview dependency fixes without applying      |
| `dojops fix-deps --npm`                | Fix npm dependencies only                      |
| `dojops fix-deps --pip`                | Fix pip dependencies only                      |
| `dojops fix-deps --output json`        | Output remediation report as JSON              |

### Autonomous Agent

| Command                             | Description                                                     |
| ----------------------------------- | --------------------------------------------------------------- |
| `dojops auto <prompt>`              | Autonomous agent mode — iterative tool-use loop (ReAct pattern) |
| `dojops auto --max-iterations=N`    | Set max loop iterations (default: 50)                           |
| `dojops auto --allow-all-paths`     | Bypass DevOps file write allowlist                              |
| `dojops auto --voice`               | Use voice input as the task prompt (requires whisper.cpp + sox) |
| `dojops auto --background <prompt>` | Run agent in background, return run ID immediately              |

The autonomous agent reads files, makes targeted changes, runs commands, and verifies — all iteratively. It uses 7 tools: `read_file`, `write_file`, `edit_file`, `run_command`, `run_skill`, `search_files`, and `done`.

Auto-memory is enabled by default — the agent injects context from previous sessions and records completed tasks. Toggle with `dojops memory auto on|off`.

### Background Runs

| Command                 | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `dojops runs list`      | List all background runs with status and duration           |
| `dojops runs show <id>` | Show run details, result, and tail of output log            |
| `dojops runs clean [N]` | Remove completed/failed runs older than N days (default: 7) |

Background runs store output in `.dojops/runs/<id>/` (meta.json, output.log, result.json). Prefix matching is supported for run IDs.

### MCP (Model Context Protocol)

| Command             | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `dojops mcp list`   | List configured MCP servers, test connections, show tools  |
| `dojops mcp add`    | Add an MCP server interactively (stdio or streamable-http) |
| `dojops mcp remove` | Remove an MCP server by name                               |

MCP servers extend the autonomous agent with external tools (databases, cloud APIs, GitHub, etc.). Configure in `.dojops/mcp.json` (project) or `~/.dojops/mcp.json` (global). Tools appear as `mcp__<server>__<tool>` in `dojops auto`.

#### MCP server mode

| Command              | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `dojops serve --mcp` | Start DojOps as an MCP server over stdio (for external CLI agents) |
| `npx @dojops/mcp`    | Standalone MCP server entry point (same behavior)                  |

Exposes 9 tools (`generate`, `plan`, `scan`, `debug-ci`, `diff-analyze`, `chat`, `list-agents`, `list-skills`, `repo-scan`) that proxy to a running `dojops serve` instance. External agents like Claude Code, Gemini CLI, and GitHub Copilot configure it as `{ "command": "dojops", "args": ["serve", "--mcp"] }`.

### Interactive

| Command                            | Description                                            |
| ---------------------------------- | ------------------------------------------------------ |
| `dojops chat`                      | Interactive multi-turn AI DevOps session               |
| `dojops chat --session=NAME`       | Resume or create a named session                       |
| `dojops chat --resume`             | Resume the most recent session                         |
| `dojops chat --agent=NAME`         | Pin conversation to a specialist agent                 |
| `dojops chat --message=TEXT`       | Send a single message and exit (scriptable, also `-m`) |
| `dojops chat --voice`              | Enable voice input mode (requires whisper.cpp + sox)   |
| `dojops chat export`               | Export all sessions as markdown                        |
| `dojops chat export <id>`          | Export a specific session                              |
| `dojops chat export --format=json` | Export as JSON instead of markdown                     |
| `dojops chat export --output=FILE` | Write export to a file instead of stdout               |

Chat supports slash commands: `/exit`, `/agent <name>`, `/model`, `/provider [name]`, `/voice`, `/plan <goal>`, `/apply`, `/auto <prompt>`, `/scan`, `/history`, `/clear`, `/save`.

### Agents & Skills

> **Note:** `dojops tools` and `dojops modules` are deprecated aliases for `dojops skills`. Use `dojops skills` instead.

| Command                              | Description                                            |
| ------------------------------------ | ------------------------------------------------------ |
| `dojops agents list`                 | List all agents (built-in + custom)                    |
| `dojops agents info <name>`          | Show agent details (supports partial names)            |
| `dojops agents create <desc>`        | Create a custom agent (LLM-generated)                  |
| `dojops agents create --manual`      | Create a custom agent interactively                    |
| `dojops agents remove <name>`        | Remove a custom agent                                  |
| `dojops skills load <path>`          | Copy a local `.dops` skill into `.dojops/skills/`      |
| `dojops skills list`                 | List discovered custom skills (global + project)       |
| `dojops skills validate <path>`      | Validate a custom skill manifest                       |
| `dojops skills init <name>`          | Scaffold a `.dops` skill (with optional AI generation) |
| `dojops skills publish <file>`       | Publish a .dops skill to the DojOps Hub                |
| `dojops skills install <name>`       | Install a .dops skill from the DojOps Hub              |
| `dojops skills search <query>`       | Search the DojOps Hub for skills                       |
| `dojops skills update`               | Update installed skills from Hub to latest versions    |
| `dojops skills update --yes`         | Update without confirmation prompts                    |
| `dojops skills export`               | Export installed skills to offline bundle              |
| `dojops skills export --output FILE` | Write bundle to a specific file                        |
| `dojops skills import <file>`        | Import skills from offline bundle                      |
| `dojops skills dev <path.dops>`      | Validate a .dops file with live feedback               |
| `dojops skills dev --watch`          | Watch mode — re-validate on file changes               |
| `dojops toolchain list`              | List system toolchain binaries with install status     |
| `dojops toolchain install <name>`    | Download binary into toolchain (~/.dojops/toolchain/)  |
| `dojops toolchain remove <name>`     | Remove a toolchain binary                              |
| `dojops toolchain clean`             | Remove all toolchain binaries                          |
| `dojops inspect [<target>]`          | Inspect config and/or session state (default: both)    |
| `dojops verify`                      | Verify audit log hash chain integrity (standalone)     |

### History & Audit

| Command                                            | Description                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `dojops history list`                              | View execution history                                                |
| `dojops history show <plan-id>`                    | Show plan details and per-task results                                |
| `dojops history verify`                            | Verify audit log hash chain integrity                                 |
| `dojops history audit`                             | List audit log entries                                                |
| `dojops history repair`                            | Repair broken audit log hash chain                                    |
| `dojops history export`                            | Export audit log (default: JSON to stdout)                            |
| `dojops history export --format json\|csv\|syslog` | Set export format                                                     |
| `dojops history export --since DATE`               | Export entries from this date onward                                  |
| `dojops history export --until DATE`               | Export entries up to this date                                        |
| `dojops history export --output FILE`              | Write export to a file instead of stdout                              |
| `dojops clean [<plan-id>]`                         | Remove generated artifacts from a plan                                |
| `dojops destroy <plan-id>`                         | Deprecated alias for `clean`                                          |
| `dojops rollback <plan-id>`                        | Reverse an applied plan (delete created files + restore .bak backups) |

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
| `dojops config backup`                        | Save current config as a timestamped backup                                                                                                       |
| `dojops config restore [file]`                | Restore config from a backup (interactive picker if no file given)                                                                                |
| `dojops config apply <file>`                  | Import config from a YAML or JSON file                                                                                                            |
| `dojops config export <file>`                 | Export current config to a YAML or JSON file                                                                                                      |
| `dojops auth login`                           | Authenticate with LLM provider                                                                                                                    |
| `dojops auth status`                          | Show saved tokens and default provider                                                                                                            |
| `dojops serve [--port=N]`                     | Start API server + web dashboard                                                                                                                  |
| `dojops serve --mcp`                          | Start DojOps as an MCP server (stdio transport) for external agents                                                                               |
| `dojops serve --no-auth`                      | Start server without API key authentication (local dev only)                                                                                      |
| `dojops serve --tls-cert=PATH --tls-key=PATH` | Enable HTTPS/TLS on the API server                                                                                                                |
| `dojops serve credentials`                    | Generate API key for dashboard/API authentication                                                                                                 |
| `dojops init`                                 | Initialize `.dojops/` + comprehensive repo scan (11 CI, IaC, scripts, security)                                                                   |
| `dojops status`                               | System health diagnostics + project metrics (alias: `doctor`, `--fix` to auto-repair). Always shows installed tools regardless of project context |
| `dojops upgrade`                              | Check for and install CLI updates (`--check` for check-only)                                                                                      |

### Observability & Memory

| Command                                                     | Description                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `dojops tokens`                                             | Show LLM token usage analytics (per provider, daily, total) |
| `dojops insights [category]`                                | Surface actionable insights from project history            |
| `dojops insights --all`                                     | Show all insights (default: top 10)                         |
| `dojops insights efficiency`                                | Filter to efficiency insights only                          |
| `dojops insights security`                                  | Filter to security insights only                            |
| `dojops insights quality`                                   | Filter to quality insights only                             |
| `dojops insights cost`                                      | Filter to cost insights only                                |
| `dojops memory list`                                        | List persistent project notes                               |
| `dojops memory list --category=TYPE`                        | Filter notes by category                                    |
| `dojops memory add <text>`                                  | Add a project note                                          |
| `dojops memory add <text> --category=TYPE --keywords=k1,k2` | Add with category and keywords                              |
| `dojops memory remove <id>`                                 | Remove a note by ID (alias: `rm`)                           |
| `dojops memory search <query>`                              | Search notes by keyword                                     |
| `dojops memory auto [on\|off]`                              | Toggle auto-memory enrichment for `dojops auto`             |
| `dojops memory errors`                                      | List learned error patterns (frequency, resolution status)  |

### Scheduled Jobs

| Command                                  | Description                                         |
| ---------------------------------------- | --------------------------------------------------- |
| `dojops cron`                            | Show cron usage                                     |
| `dojops cron add "<schedule>" <command>` | Add a scheduled DojOps job (cron expression + args) |
| `dojops cron list`                       | List all scheduled jobs                             |
| `dojops cron remove <job-id>`            | Remove a scheduled job                              |

### Shell Completion

| Command                             | Description                            |
| ----------------------------------- | -------------------------------------- |
| `dojops completion bash`            | Print bash completion script           |
| `dojops completion zsh`             | Print zsh completion script            |
| `dojops completion fish`            | Print fish completion script           |
| `dojops completion install`         | Auto-detect shell, install completions |
| `dojops completion install <shell>` | Install for specific shell             |

**Quick setup:**

```bash
# Bash
dojops completion install bash
# or manually: dojops completion bash > ~/.bash_completion.d/dojops

# Zsh
dojops completion install zsh
# or manually: dojops completion zsh > ~/.zsh/completions/_dojops

# Fish
dojops completion install fish
# or manually: dojops completion fish > ~/.config/fish/completions/dojops.fish
```

---

## Global Options

| Option                     | Description                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `--provider=NAME`          | LLM provider: `openai`, `anthropic`, `ollama`, `deepseek`, `gemini`, `github-copilot` |
| `--model=NAME`             | LLM model override                                                                    |
| `--temperature=N`          | LLM temperature (0-2) for deterministic reproducibility                               |
| `--fallback-provider=NAME` | Fallback LLM provider (used when primary fails)                                       |
| `--profile=NAME`           | Use named config profile                                                              |
| `--skill=NAME`             | Force a specific skill for `generate`, `plan`, or `apply` (bypasses agent routing)    |
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

# Force a specific skill (bypass agent routing)
dojops --skill=terraform "Create an S3 bucket with versioning"
dojops --skill=kubernetes "Create a deployment for nginx"
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

### Autonomous Agent

```bash
# Let the agent iteratively read, edit, and verify
dojops auto "Add a health check endpoint to the Express API"
dojops auto "Create CI for this Node app — read package.json first"
dojops auto "Fix the failing Terraform validation" --max-iterations=30
dojops auto "Refactor the Dockerfile to multi-stage build" --allow-all-paths

# Voice input — speak the task instead of typing
dojops auto --voice

# Background mode — fire and forget
dojops auto --background "Set up monitoring for all services"
dojops runs list                  # check status
dojops runs show abc12345         # view result + output log
dojops runs clean                 # remove old completed runs
```

### MCP Servers

```bash
# List configured MCP servers and test connections
dojops mcp list

# Add an MCP server interactively
dojops mcp add
# Prompts for: name, transport (stdio/streamable-http), command/URL

# Add MCP server config manually (.dojops/mcp.json)
cat > .dojops/mcp.json << 'EOF'
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "github": {
      "transport": "streamable-http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
EOF

# Remove a server
dojops mcp remove filesystem

# Agent auto-discovers MCP tools
dojops auto "Use the filesystem MCP server to list /tmp contents"
```

### Planning and Execution

```bash
# Decompose a complex goal into tasks
dojops plan "Set up CI/CD for a Node.js app with Docker and Kubernetes"

# Voice input — speak the plan goal instead of typing
dojops plan --voice
dojops plan --voice --execute --yes   # speak + plan + execute

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
dojops apply --parallel 5        # 5 concurrent tasks per wave (semaphore)
dojops apply --replay           # deterministic: temp=0, validate env match
dojops apply --replay --yes     # force replay despite mismatches

# Force a specific skill for planning or execution
dojops --skill=terraform plan "Set up S3 with CloudFront"
dojops apply plan-abc --skill=terraform   # only run terraform tasks from plan
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

# Voice-enabled chat (requires whisper.cpp + sox)
dojops chat --voice

# In-session: switch provider mid-conversation
# /provider anthropic
# /provider ollama

# In-session: push-to-talk voice input
# /voice
```

### Toolchain Management

```bash
# Check available toolchain binaries
dojops toolchain list

# Install external validators
dojops toolchain install terraform
dojops toolchain install kubectl
dojops toolchain install hadolint

# Install voice input engine (whisper.cpp + model)
dojops toolchain install whisper-cpp

# Cleanup
dojops toolchain clean
```

### Voice Input Setup

Voice input uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp) for local speech-to-text and [SoX](https://sox.sourceforge.net/) for audio recording. All processing happens locally — no audio data leaves your machine.

#### Prerequisites

Voice input requires two system dependencies:

| Dependency      | Purpose                                    | Installed via                          |
| --------------- | ------------------------------------------ | -------------------------------------- |
| **whisper.cpp** | Speech-to-text engine (local AI model)     | `dojops toolchain install whisper-cpp` |
| **SoX**         | Audio recording (`rec` command)            | System package manager                 |
| **cmake**       | Build tool (needed to compile whisper.cpp) | System package manager                 |
| **C compiler**  | Build tool (gcc or clang)                  | System package manager                 |

#### Step 1: Install build tools and SoX

**macOS:**

```bash
xcode-select --install      # C compiler
brew install cmake sox
```

**Linux / WSL (Debian/Ubuntu):**

```bash
sudo apt update
sudo apt install build-essential cmake git sox libsox-fmt-all
```

**Linux (Fedora/RHEL):**

```bash
sudo dnf install gcc gcc-c++ cmake git sox sox-plugins-freeworld
```

**Linux (Arch):**

```bash
sudo pacman -S base-devel cmake git sox
```

**Windows:**
SoX can be installed from [the SoX SourceForge page](https://sox.sourceforge.net/). Voice input on Windows is experimental.

#### Step 2: Install whisper.cpp

This builds whisper.cpp from source using cmake and downloads the default model (~142 MB). The binary and all shared libraries are installed into `~/.dojops/toolchain/`, and the model is stored at `~/.dojops/voice/ggml-base.en.bin`.

```bash
dojops toolchain install whisper-cpp
```

> **Note:** whisper-cpp always installs globally (shared model file). No scope prompt is shown.

#### Step 3: Verify

```bash
dojops doctor          # Shows voice dependency status under "Voice" section
```

You should see:

```
  Voice: whisper.cpp   pass   Found (~/.dojops/toolchain/bin/whisper-cli)
  Voice: SoX (rec)     pass   Found (/usr/bin/rec)
  Voice: whisper model  pass   Found (~/.dojops/voice/ggml-base.en.bin)
```

#### Using voice input

Voice input is available in three modes:

**1. Chat mode — `/voice` slash command:**

```bash
dojops chat
# Then type: /voice
# Recording starts — press Enter to stop
# Transcribed text is sent as a chat message
```

**2. Chat mode — `--voice` flag (pre-validates dependencies):**

```bash
dojops chat --voice
# Then type: /voice anytime during the session
```

**3. Plan command — `--voice` flag (voice as prompt):**

```bash
dojops plan --voice
# Recording starts — press Enter to stop
# Transcribed text becomes the plan prompt

# Combine with --execute to plan + execute in one step:
dojops plan --voice --execute
dojops plan --voice --execute --yes
```

**4. Autonomous agent — `--voice` flag (voice as task):**

```bash
dojops auto --voice
# Recording starts — press Enter to stop
# Transcribed text becomes the autonomous agent task
```

#### How recording works

- When recording starts, you'll see: `Recording... Speak now (press Enter to stop, max 30s)`
- **Press Enter** (or Space) to stop recording — the audio is sent for transcription
- **Ctrl+C** also stops recording without exiting the session
- Maximum recording duration is 30 seconds
- Audio is recorded at 16kHz mono WAV (what whisper.cpp expects)
- Temporary audio files are cleaned up automatically after transcription

#### Environment variables (optional — most users don't need these)

DojOps auto-detects whisper.cpp from the toolchain and system PATH. These variables are only needed if your binary or model is in a non-standard location (e.g. custom builds, CI environments):

- `DOJOPS_WHISPER_BIN` — Override the whisper binary path (normally auto-detected from `~/.dojops/toolchain/bin/` and PATH)
- `DOJOPS_WHISPER_MODEL` — Override the model file path (normally auto-detected from `~/.dojops/voice/ggml-base.en.bin`)

### Custom Skill Management

```bash
# List discovered custom skills (global + project)
dojops skills list

# Search the DojOps Hub for skills
dojops skills search docker
dojops skills search terraform --limit 5
dojops skills search k8s --output json

# Scaffold a .dops skill (uses AI when provider is configured)
dojops skills init my-skill

# Validate a custom skill
dojops skills validate my-skill

# Publish a skill to DojOps Hub (requires DOJOPS_HUB_TOKEN)
dojops skills publish my-skill.dops --changelog "Initial release"

# Install a skill from DojOps Hub
dojops skills install nginx-config
dojops skills install nginx-config --version 1.0.0 --global
```

### Hub Publishing Setup

Publishing skills to the [DojOps Hub](https://hub.dojops.ai) requires an API token:

```bash
# 1. Sign in at hub.dojops.ai → Settings → API Tokens
# 2. Generate a token (format: dojops_<40-hex-chars>)
# 3. Set the environment variable:
export DOJOPS_HUB_TOKEN="dojops_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

# Publish a skill
dojops skills publish my-skill.dops

# Publish with changelog
dojops skills publish my-skill.dops --changelog "v1.1.0: Added Redis support"

# Install from hub (no token required)
dojops skills install my-skill
dojops skills install my-skill --version 1.0.0 --global
```

The CLI sends the token as a `Bearer` header. Tokens can be managed (created, viewed, revoked) from the Hub Settings page at `/settings/tokens`. See the [skills documentation](skills.md#hub-integration) for the full publish/install flow.

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

# Backup and restore
dojops config backup                     # Save timestamped backup
dojops config restore                    # Interactive picker
dojops config restore ~/.dojops/backups/config-2026-03-12.json

# Import and export
dojops config export config.yaml         # Export to YAML
dojops config apply config.yaml          # Import from YAML/JSON
```

### Observability & Memory

```bash
# Token usage analytics
dojops tokens
dojops tokens --output json

# Opportunity detection
dojops insights                          # Top 10 insights across all categories
dojops insights --all                    # Show everything
dojops insights security                 # Filter to security only
dojops insights quality --output json    # JSON output

# Project memory
dojops memory add "Always use t3.medium for staging"
dojops memory add "Terraform state in S3" --category=convention --keywords=terraform,s3
dojops memory list
dojops memory list --category=convention
dojops memory search terraform
dojops memory remove 3

# Auto-memory (enriches dojops auto with session context)
dojops memory auto               # check status (on/off)
dojops memory auto off           # disable auto-enrichment
dojops memory errors             # list learned error patterns
```

### Scheduled Jobs

```bash
dojops cron add "0 2 * * *" plan "backup terraform"   # Schedule nightly plan
dojops cron add "*/30 * * * *" scan --security         # Scan every 30 min
dojops cron list                                        # View all jobs
dojops cron remove job-abc123                           # Remove a job
```

### Skill Development

```bash
dojops skills dev my-tool.dops          # Validate a skill
dojops skills dev my-tool.dops --watch  # Watch mode
```

### Chat Export

```bash
dojops chat export                       # Export all sessions as markdown
dojops chat export session-123           # Export specific session
dojops chat export --format=json         # Export as JSON
dojops chat export --output=chat.md      # Save to file
```
