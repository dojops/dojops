# Configuration

DojOps supports 5 LLM providers with flexible configuration via CLI flags, environment variables, config files, and named profiles.

---

## Supported Providers

| Provider  | `DOJOPS_PROVIDER` | Required Env Var    | Default Model                | SDK                   |
| --------- | ----------------- | ------------------- | ---------------------------- | --------------------- |
| OpenAI    | `openai`          | `OPENAI_API_KEY`    | `gpt-4o-mini`                | `openai`              |
| Anthropic | `anthropic`       | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` | `@anthropic-ai/sdk`   |
| Ollama    | `ollama`          | _(none -- local)_   | `llama3`                     | `ollama`              |
| DeepSeek  | `deepseek`        | `DEEPSEEK_API_KEY`  | `deepseek-chat`              | `openai` (compatible) |
| Gemini    | `gemini`          | `GEMINI_API_KEY`    | `gemini-2.5-flash`           | `@google/genai`       |

---

## Configuration Methods

### Interactive Setup

```bash
dojops config
```

The interactive wizard:

1. Selects a provider from the list
2. Prompts for the API key
3. Fetches available models from the provider's API via `listModels()`
4. Shows an interactive model picker

### Environment Variables

```bash
export DOJOPS_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export DOJOPS_MODEL=gpt-4o              # Optional model override
export DOJOPS_API_PORT=3000              # API server port (default: 3000)
```

### CLI Flags

```bash
dojops --provider=anthropic "Create a Terraform config"
dojops --model=gpt-4o "Create a Kubernetes deployment"
```

### Config File

DojOps saves configuration to `~/.dojops/config.json`:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "token": "sk-..."
}
```

---

## Configuration Precedence

Values are resolved in order (first match wins):

```
Provider:  --provider flag  >  $DOJOPS_PROVIDER  >  config file  >  "openai" (default)
Model:     --model flag     >  $DOJOPS_MODEL     >  config file  >  provider default
Token:     $OPENAI_API_KEY (etc.)  >  config file token
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
- **Gemini** — Lists available Gemini models

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

| Variable            | Description           | Default          |
| ------------------- | --------------------- | ---------------- |
| `DOJOPS_PROVIDER`   | LLM provider name     | `openai`         |
| `DOJOPS_MODEL`      | Model override        | Provider default |
| `OPENAI_API_KEY`    | OpenAI API key        | --               |
| `ANTHROPIC_API_KEY` | Anthropic API key     | --               |
| `DEEPSEEK_API_KEY`  | DeepSeek API key      | --               |
| `GEMINI_API_KEY`    | Google Gemini API key | --               |
| `DOJOPS_API_PORT`   | API server port       | `3000`           |

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

Ollama must be running at `localhost:11434`.

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
