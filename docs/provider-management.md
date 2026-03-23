# Provider Management

DojOps supports 7 LLM providers. The `dojops provider` command provides a dedicated interface for managing them - adding tokens, switching defaults, and viewing status.

---

## Supported Providers

| Provider       | Name             | Token Required    | Default Model                |
| -------------- | ---------------- | ----------------- | ---------------------------- |
| OpenAI         | `openai`         | Yes               | `gpt-4o-mini`                |
| Anthropic      | `anthropic`      | Yes               | `claude-sonnet-4-5-20250929` |
| DeepSeek       | `deepseek`       | Yes               | `deepseek-chat`              |
| Mistral        | `mistral`        | Yes               | `mistral-small`              |
| Gemini         | `gemini`         | Yes               | `gemini-2.5-flash`           |
| Ollama         | `ollama`         | No (local)        | `llama3`                     |
| GitHub Copilot | `github-copilot` | OAuth Device Flow | `gpt-4o`                     |

---

## Commands

### `provider list`

List all providers with their configuration status. This is the default when running `dojops provider` without a subcommand.

```bash
dojops provider
dojops provider list
dojops provider list --output json
```

Output shows configured (`*`) vs unconfigured (`o`) providers, the default provider, masked tokens, and the active model:

```
┌ Providers ──────────────────────────────────────┐
│  * anthropic         sk-***ntx                  │
│  * openai (default)  sk-***ojx  model: gpt-4o   │
│  o deepseek          (not set)                  │
│  o gemini            (not set)                  │
│  * ollama            (local)                    │
└─────────────────────────────────────────────────┘
```

### `provider add <name>`

Add or update a provider token.

```bash
# With token flag (non-interactive)
dojops provider add openai --token sk-proj-xxx

# Interactive (prompts for token)
dojops provider add anthropic
```

**Smart default behavior:**

- **First provider** — Automatically set as the default
- **Subsequent providers** — Existing default is preserved, with a hint to switch

```
$ dojops provider add anthropic --token sk-ant-xxx
✓ Token saved for anthropic.
  anthropic set as default provider (first configured provider).

$ dojops provider add openai --token sk-proj-xxx
✓ Token saved for openai.
  Default provider remains anthropic. Use `dojops provider default openai` to switch.
```

**Ollama** does not require a token. In interactive mode, you'll be prompted for the server URL (and TLS settings for HTTPS URLs):

```bash
dojops provider add ollama
# Prompts: Ollama server URL: (default http://localhost:11434)
# For HTTPS: Verify TLS certificates? (y/n)
```

You can also set the host via the `OLLAMA_HOST` environment variable or `dojops config`.

**GitHub Copilot** uses OAuth Device Flow instead of a token. Running `provider add` triggers the interactive flow and presents a model picker after authentication:

```bash
dojops provider add github-copilot
# Shows: Code: XXXX-XXXX, URL: https://github.com/login/device
# → Open URL, enter code, authorize
# ✓ Authenticated with GitHub Copilot.
# → Select default model: gpt-4o, gpt-4o-mini, claude-3.5-sonnet, o1-mini, ...
```

### `provider remove <name>`

Remove a provider's token.

```bash
dojops provider remove openai
```

If the removed provider was the default, the default is cleared and an alternative is suggested:

```
✓ Token removed for openai.
⚠ openai was the default provider. Use `dojops provider default anthropic` to set a new default.
```

### `provider default <name>`

Set the default provider directly (for scripting and CI).

```bash
dojops provider default anthropic
```

If no token is configured for the provider, a warning is shown (but the default is still set).

Shortcut flag — works from anywhere in the provider command:

```bash
dojops provider --as-default openai
```

### `provider switch`

Interactive picker that shows only configured providers. Best for quick switching during development.

```bash
dojops provider switch
```

```
◆ Switch default provider to:
│ ○ anthropic
│ ● openai (current default)
│ ○ ollama
└
```

Requires interactive mode. In CI or with `--non-interactive`, use `provider default <name>` instead.

---

## Workflows

### First-Time Setup

```bash
# Install and add your first provider
npm i -g @dojops/cli
dojops provider add openai --token sk-...

# Verify
dojops provider
dojops "Create a Terraform config for S3"
```

### Adding a Second Provider

```bash
# Add without changing default
dojops provider add anthropic --token sk-ant-...

# Use it for a one-off command
dojops --provider=anthropic "Create a Kubernetes deployment"

# Or switch the default
dojops provider switch
```

### CI/CD Usage

```bash
# Non-interactive: use flags
dojops provider add openai --token "$OPENAI_API_KEY"
dojops provider default openai
```

### Rotating Tokens

```bash
# Update an existing provider's token
dojops provider add openai --token sk-new-key-xxx
```

Running `provider add` for an already-configured provider updates the token without changing the default.

---

## Related Commands

- **`dojops config`** — Full interactive wizard (provider + model + token in one flow)
- **`dojops auth login`** — Save a token for a provider (similar to `provider add`)
- **`dojops auth status`** — View saved tokens
- **`dojops config profile`** — Named profiles for switching entire configurations
- **`dojops inspect config`** — View resolved runtime configuration

---

## Configuration File

Provider tokens are stored in `~/.dojops/config.json`:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-4o",
  "tokens": {
    "openai": "sk-...",
    "anthropic": "sk-ant-..."
  }
}
```

The file is created with `0o600` permissions (owner read/write only). The directory is created with `0o700`.
