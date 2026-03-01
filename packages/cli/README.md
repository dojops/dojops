# @dojops/cli

CLI for [DojOps](https://github.com/dojops/dojops) — AI DevOps Automation Engine.

Generate, validate, and execute infrastructure & CI/CD configurations using LLM providers from your terminal.

## Install

```bash
npm i -g @dojops/cli
```

## Usage

```bash
# Generate a configuration
dojops "Create a GitHub Actions CI for Node.js"

# Plan & execute
dojops --plan "Set up Terraform for AWS S3"
dojops --execute --yes "Create a Dockerfile for Node.js"

# Debug CI failures
dojops debug ci "paste CI log here..."

# Analyze infrastructure diffs
dojops analyze diff "terraform plan output..."

# Security scanning
dojops scan --security --deps --iac

# Interactive chat
dojops chat

# Start API server + web dashboard
dojops serve
```

## Commands

| Command                      | Description                             |
| ---------------------------- | --------------------------------------- |
| `dojops "prompt"`            | Generate a DevOps configuration         |
| `dojops --plan "prompt"`     | Decompose into a task graph and execute |
| `dojops --execute "prompt"`  | Generate and write files to disk        |
| `dojops debug ci "log"`      | Diagnose CI/CD failures                 |
| `dojops analyze diff "diff"` | Analyze infrastructure diffs            |
| `dojops scan`                | Run security/dependency/IaC scans       |
| `dojops chat`                | Interactive AI chat session             |
| `dojops serve`               | Start REST API + web dashboard          |
| `dojops tools list`          | List available DevOps tools             |
| `dojops agents list`         | List specialist agents                  |
| `dojops doctor`              | System health check                     |

## Configuration

Set your LLM provider via environment variables:

```bash
export DOJOPS_PROVIDER=openai    # openai | anthropic | ollama | deepseek | gemini | github-copilot
export OPENAI_API_KEY=sk-...
```

## Part of DojOps

This package is the CLI entry point for the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
