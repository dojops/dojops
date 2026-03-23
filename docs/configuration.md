# Configuration

DojOps supports 7 LLM providers with flexible configuration via CLI flags, environment variables, config files, and named profiles.

---

## Supported Providers

| Provider       | `DOJOPS_PROVIDER` | Required Env Var      | Default Model                | SDK                   |
| -------------- | ----------------- | --------------------- | ---------------------------- | --------------------- |
| OpenAI         | `openai`          | `OPENAI_API_KEY`      | `gpt-4o-mini`                | `openai`              |
| Anthropic      | `anthropic`       | `ANTHROPIC_API_KEY`   | `claude-sonnet-4-5-20250929` | `@anthropic-ai/sdk`   |
| Ollama         | `ollama`          | _(none -- local)_     | `llama3`                     | `ollama`              |
| DeepSeek       | `deepseek`        | `DEEPSEEK_API_KEY`    | `deepseek-chat`              | `openai` (compatible) |
| Mistral        | `mistral`         | `MISTRAL_API_KEY`     | `mistral-small`              | `openai` (compatible) |
| Gemini         | `gemini`          | `GEMINI_API_KEY`      | `gemini-2.5-flash`           | `@google/genai`       |
| GitHub Copilot | `github-copilot`  | _(OAuth Device Flow)_ | `gpt-4o`                     | `openai` (compatible) |

---

## Provider Management

DojOps includes a dedicated `provider` command for managing LLM providers — adding, removing, switching, and listing them.

### Adding Providers

```bash
# Add your first provider (auto-set as default)
dojops provider add openai --token sk-...

# Add a second provider (preserves existing default)
dojops provider add anthropic --token sk-ant-...

# Ollama (local, no token needed)
dojops provider add ollama
```

### Switching Providers

```bash
# Interactive picker — shows only configured providers
dojops provider switch

# Direct — set by name
dojops provider default anthropic

# Shortcut flag
dojops provider --as-default openai
```

### Listing Providers

```bash
# Table view (default)
dojops provider

# JSON output
dojops provider list --output json
```

Output shows configured (`*`) vs unconfigured (`o`) providers, with the default marked:

```
┌ Providers ──────────────────────────────────────┐
│  * anthropic         sk-***ntx                  │
│  * openai (default)  sk-***ojx  model: gpt-4o   │
│  o deepseek          (not set)                  │
│  o gemini            (not set)                  │
│  * ollama            (local)                    │
└─────────────────────────────────────────────────┘
```

### Removing Providers

```bash
dojops provider remove openai
```

If the removed provider was the default, DojOps clears the default and suggests an alternative.

---

## Configuration Methods

### Interactive Setup

```bash
dojops config
```

The interactive wizard:

1. Selects a provider from the list
2. Prompts for the API key (skipped for Ollama and GitHub Copilot)
3. For GitHub Copilot: runs the OAuth Device Flow automatically if not already authenticated
4. Fetches available models from the provider's API via `listModels()`
5. Shows an interactive model picker
6. Asks whether to switch default provider (if one already exists)
7. Offers to configure another provider

### Environment Variables

```bash
export DOJOPS_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export DOJOPS_MODEL=gpt-4o              # Optional model override
export DOJOPS_TEMPERATURE=0.7           # Optional temperature override
export DOJOPS_API_PORT=3000              # API server port (default: 3000)
```

### CLI Flags

```bash
dojops --provider=anthropic "Create a Terraform config"
dojops --model=gpt-4o "Create a Kubernetes deployment"
dojops --temperature=0.2 "Create a Terraform config"
```

### Config File

DojOps saves configuration to `~/.dojops/config.json`:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "defaultTemperature": 0.7,
  "token": "sk-..."
}
```

---

## Configuration Precedence

Values are resolved in order (first match wins):

```
Provider:     --provider flag     >  $DOJOPS_PROVIDER     >  config file  >  "openai" (default)
Model:        --model flag        >  $DOJOPS_MODEL        >  config file  >  provider default
Temperature:  --temperature flag  >  $DOJOPS_TEMPERATURE  >  config file  >  undefined (provider default)
              Note: `apply --replay` forces temperature=0 regardless of other settings
Token:        $OPENAI_API_KEY (etc.)  >  config file token
```

---

## Model Selection

Each provider ships with a sensible default, but you can choose any model your provider supports:

```bash
# Interactive: fetches models from provider API, shows picker
dojops config

# Set directly in config
dojops config --model=gpt-4o

# One-off override (doesn't change saved config)
dojops --model=deepseek-reasoner "Analyze this Terraform plan"
```

### Dynamic Model Discovery

When running `dojops config`, DojOps calls the provider's `listModels()` API to fetch available models:

- **OpenAI** — Lists models from the OpenAI API
- **Anthropic** — Lists supported Claude models
- **Ollama** — Lists locally installed models
- **DeepSeek** — Lists available DeepSeek models
- **Mistral** - Lists available Mistral models
- **Gemini** - Lists available Gemini models
- **GitHub Copilot** - Lists models available to your Copilot subscription tier

---

## Profiles

Named profiles let you switch between different provider/environment configurations:

### Create a Profile

```bash
# Save current config as a named profile
dojops config profile create staging
```

### Use a Profile

```bash
# Switch to a profile (updates active config)
dojops config profile use staging

# One-off profile override (doesn't change active config)
dojops --profile=staging "Create an S3 bucket"
```

### List Profiles

```bash
dojops config profile list
```

### Example: Multi-Environment Setup

```bash
# Set up development profile (local Ollama)
export DOJOPS_PROVIDER=ollama
dojops config
dojops config profile create dev

# Set up production profile (OpenAI)
export DOJOPS_PROVIDER=openai
export OPENAI_API_KEY=sk-prod-...
dojops config --model=gpt-4o
dojops config profile create prod

# Switch between them
dojops config profile use dev    # Uses local Ollama
dojops config profile use prod   # Uses OpenAI GPT-4o
```

---

## Environment Variables Reference

| Variable                         | Description                            | Default                  |
| -------------------------------- | -------------------------------------- | ------------------------ |
| `DOJOPS_PROVIDER`                | LLM provider name                      | `openai`                 |
| `DOJOPS_MODEL`                   | Model override                         | Provider default         |
| `DOJOPS_TEMPERATURE`             | Temperature override                   | Provider default         |
| `OPENAI_API_KEY`                 | OpenAI API key                         | --                       |
| `ANTHROPIC_API_KEY`              | Anthropic API key                      | --                       |
| `DEEPSEEK_API_KEY`               | DeepSeek API key                       | --                       |
| `MISTRAL_API_KEY`                | Mistral API key                        | --                       |
| `GEMINI_API_KEY`                 | Google Gemini API key                  | --                       |
| `DOJOPS_API_PORT`                | API server port                        | `3000`                   |
| `OLLAMA_HOST`                    | Ollama server URL                      | `http://localhost:11434` |
| `OLLAMA_TLS_REJECT_UNAUTHORIZED` | TLS cert verification for Ollama       | `true`                   |
| `GITHUB_COPILOT_TOKEN`           | GitHub OAuth token (skip device flow)  | --                       |
| `DOJOPS_VAULT_KEY`               | Passphrase for encrypted secrets vault | --                       |

### Ollama Setup

Ollama runs locally and doesn't require an API key:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull llama3

# Configure DojOps
export DOJOPS_PROVIDER=ollama
dojops "Create a Dockerfile for Node.js"
```

By default, DojOps connects to Ollama at `http://localhost:11434`. To use a remote or custom Ollama server:

```bash
# Interactive setup (prompts for URL + TLS settings)
dojops config

# Or set via environment variable
export OLLAMA_HOST=https://ollama.corp.internal:8443

# For self-signed certificates behind proxies
export OLLAMA_TLS_REJECT_UNAUTHORIZED=false
```

The Ollama host URL is resolved with this priority: `OLLAMA_HOST` env > `~/.dojops/config.json` > `http://localhost:11434`.

### GitHub Copilot Setup

GitHub Copilot uses an OAuth Device Flow instead of a static API key. You need an active GitHub Copilot subscription (Pro, Pro+, Business, or Enterprise).

```bash
# Authenticate via Device Flow (opens browser)
dojops auth login --provider github-copilot

# Or use the provider command
dojops provider add github-copilot

# Or configure interactively
dojops config
# Select "github-copilot" → Device Flow runs automatically → model picker shown
```

The Device Flow works as follows:

1. DojOps requests a one-time device code from GitHub
2. You open `https://github.com/login/device` in your browser and enter the code
3. DojOps polls GitHub for authorization
4. Once approved, DojOps exchanges the OAuth token for a short-lived Copilot JWT
5. The JWT is cached and auto-refreshed before each API call (~30 min expiry)
6. DojOps fetches available models and shows an interactive picker to select the default model

Tokens are stored in `~/.dojops/copilot-token.json` (mode 0600). The Copilot API is OpenAI-compatible, so you can use models like `gpt-4o`, `gpt-4o-mini`, `claude-3.5-sonnet`, `o1-mini`, etc. depending on your subscription tier. After authentication, all three commands (`auth login`, `provider add`, and `config`) will present a model picker so you can choose your preferred model immediately.

For CI/CD, you can set `GITHUB_COPILOT_TOKEN` to a GitHub OAuth token (`ghu_xxx`) to skip the interactive Device Flow.

---

## Encrypted Secrets Vault

DojOps can encrypt API tokens at rest using AES-256-GCM instead of storing them as plaintext in `config.json`.

### How It Works

When you add a provider with `dojops provider add`, DojOps encrypts the token using:

1. A passphrase (prompted interactively) or the `DOJOPS_VAULT_KEY` environment variable
2. **scrypt** key derivation (N=2^14, r=8, p=1) to derive the encryption key
3. **AES-256-GCM** authenticated encryption with a random 16-byte IV and 16-byte auth tag

Encrypted tokens are stored in `~/.dojops/vault.json` instead of plaintext in `config.json`.

### Environment Variable

For CI/CD and non-interactive use, set the vault passphrase via environment variable:

```bash
export DOJOPS_VAULT_KEY="your-passphrase"
```

### Vault Status

```bash
dojops config vault-status     # Show vault state (encrypted provider count)
```

---

## Config Backup & Restore

```bash
# Save current config as a timestamped backup
dojops config backup

# Restore from a backup (interactive picker)
dojops config restore

# Restore from a specific file
dojops config restore ~/.dojops/backups/config-2026-03-12T10-00-00.json
```

Backups are saved to `~/.dojops/backups/` with timestamps in the filename.

---

## Config Import & Export

```bash
# Export current config to YAML or JSON
dojops config export config.yaml
dojops config export config.json

# Import config from a file (merges with existing config)
dojops config apply staging-config.yaml
dojops config apply config.json
```

File format is detected from the extension (`.yaml`/`.yml` for YAML, `.json` for JSON).

---

## Viewing Configuration

```bash
# Show current config
dojops config show

# Show system health and config
dojops doctor

# Inspect detailed config state
dojops inspect config
```

---

## `.env` File

For development, create a `.env` file in the project root:

```bash
# .env
DOJOPS_PROVIDER=openai
OPENAI_API_KEY=sk-...
DOJOPS_MODEL=gpt-4o-mini
DOJOPS_API_PORT=3000
```

See `.env.example` in the repository for a template.
