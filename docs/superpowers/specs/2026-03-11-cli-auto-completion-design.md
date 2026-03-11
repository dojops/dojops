# Design: CLI Auto-Completion

**Date:** 2026-03-11

---

## Summary

Add shell auto-completion for the `dojops` CLI, supporting Bash, Zsh, and Fish. Completions are hybrid: commands and flags are hardcoded in shell scripts (fast), while dynamic values (agents, modules, providers) are fetched at completion time via a hidden `--get-completions` flag.

---

## Command Interface

```
dojops completion bash              # Print bash completion script to stdout
dojops completion zsh               # Print zsh completion script to stdout
dojops completion fish              # Print fish completion script to stdout
dojops completion install           # Auto-detect shell, install to standard location
dojops completion install <shell>   # Install for specific shell
```

`dojops completion` with no argument prints usage and exits with code 2:

```
Usage: dojops completion <bash|zsh|fish>
       dojops completion install [bash|zsh|fish]

Generate shell completion scripts for dojops.
```

Hidden internal flag (not user-facing):

```
dojops --get-completions providers  # Newline-separated provider list
dojops --get-completions agents     # Newline-separated agent list
dojops --get-completions modules    # Newline-separated module list
```

Unknown completion types (e.g., `--get-completions unknown`) print nothing and exit 0 (silent no-op).

---

## Architecture

### New Files

| File                                      | Purpose                                |
| ----------------------------------------- | -------------------------------------- |
| `packages/cli/src/completions/bash.ts`    | Bash completion script (string export) |
| `packages/cli/src/completions/zsh.ts`     | Zsh completion script (string export)  |
| `packages/cli/src/completions/fish.ts`    | Fish completion script (string export) |
| `packages/cli/src/commands/completion.ts` | `completion` command handler           |

### Modified Files

| File                                 | Change                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `packages/cli/src/parser.ts`         | Add `completion` to `KNOWN_COMMANDS`, add `--get-completions` early-exit handling |
| `packages/cli/src/index.ts`          | Register `completion` command + subcommands, import + wire `--get-completions`    |
| `packages/cli/src/commands/index.ts` | Register `completion` subcommands (bash, zsh, fish, install)                      |
| `packages/cli/src/help.ts`           | Add `completion` command help text                                                |

---

## Complete Command Tree

### Top-Level Commands (31 total, including new `completion`)

```
plan        generate    apply       validate    explain
debug       analyze     review      auto        inspect
agents      history     modules     tools       toolchain
scan        chat        check       verify      provider
config      auth        serve       status      doctor
init        clean       destroy     rollback    cron
upgrade     help        completion
```

Note: `doctor` = alias for `status`, `destroy` = deprecated alias for `clean`, `tools` = deprecated alias for `modules`.

### Subcommand Map

| Parent           | Subcommands                                                       |
| ---------------- | ----------------------------------------------------------------- |
| `debug`          | `ci`                                                              |
| `analyze`        | `diff`                                                            |
| `agents`         | `list`, `info`, `create`, `remove`                                |
| `history`        | `list`, `show`, `verify`, `audit`, `repair`                       |
| `modules`        | `list`, `init`, `validate`, `publish`, `install`, `search`, `dev` |
| `tools`          | `list`, `init`, `validate`, `publish`, `install`, `search`, `dev` |
| `toolchain`      | `list`, `load`, `install`, `remove`, `clean`                      |
| `config`         | `show`, `get`, `set`, `delete`, `validate`, `reset`, `profile`    |
| `config profile` | `create`, `use`, `delete`, `list`                                 |
| `auth`           | `login`, `status`, `logout`                                       |
| `serve`          | `credentials`                                                     |
| `chat`           | `export`                                                          |
| `inspect`        | `config`, `session`                                               |
| `provider`       | `list`, `default`, `add`, `remove`, `switch`                      |
| `cron`           | `add`, `list`, `remove`                                           |
| `completion`     | `bash`, `zsh`, `fish`, `install`                                  |

### 3-Level Nesting

`config profile` has sub-subcommands (`create`, `use`, `delete`, `list`). The completion scripts handle this as a special case: when the command is `config` and the subcommand is `profile`, offer the third level.

---

## Global Flags (complete enumeration)

### Boolean flags

```
--verbose
--debug
--quiet
--no-color
--raw
--non-interactive
--dry-run
```

### String flags (require a value)

```
--provider <value>
--model <value>
--fallback-provider <value>
--agent <value>
--module <value>       (alias: --tool)
--file <path>          (alias: -f)
--profile <value>
```

### Validated flags (require a value with constraints)

```
--temperature <0-2>
--timeout <ms>
--output <table|json|yaml>
```

### Early-exit flags

```
--version   (alias: -V)
--help      (alias: -h)
```

All global flags are available in any command context. `--tool` completes the same as `--module` (both trigger module dynamic completions).

---

## Command-Specific Flags

| Command    | Flags                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`     | `--execute`, `--yes`, `--skip-verify`                                                                                                              |
| `apply`    | `--resume`, `--yes`, `--skip-verify`, `--force`, `--allow-all-paths`, `--install-packages`, `--replay`, `--task`, `--timeout`, `--repair-attempts` |
| `scan`     | `--security`, `--deps`, `--iac`, `--sbom`, `--license`, `--fix`, `--compare`, `--target`, `--fail-on`                                              |
| `serve`    | `--port`, `--no-auth`, `--tls-cert`, `--tls-key`                                                                                                   |
| `chat`     | `--session`, `--resume`, `--agent`, `--message` (alias: `-m`)                                                                                      |
| `auto`     | `--skip-verify`, `--force`, `--allow-all-paths`, `--repair-attempts`, `--commit`                                                                   |
| `review`   | (no command-specific flags)                                                                                                                        |
| `check`    | (no command-specific flags)                                                                                                                        |
| `generate` | (no command-specific flags beyond globals)                                                                                                         |

Commands not listed here use only global flags.

---

## Completion Coverage

### Static (hardcoded in scripts)

| Context                       | Completions                                  |
| ----------------------------- | -------------------------------------------- |
| `dojops <TAB>`                | All 31 top-level commands (enumerated above) |
| `dojops <parent> <TAB>`       | Subcommands per parent (see subcommand map)  |
| `dojops config profile <TAB>` | `create`, `use`, `delete`, `list`            |
| `dojops --<TAB>`              | All global flags (enumerated above)          |
| `dojops <command> --<TAB>`    | Command-specific flags + global flags        |
| `dojops --output <TAB>`       | `table`, `json`, `yaml`                      |
| `dojops scan --fail-on <TAB>` | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`          |

### Dynamic (via `--get-completions`)

| Context                           | Source                               |
| --------------------------------- | ------------------------------------ |
| `--provider <TAB>`                | `dojops --get-completions providers` |
| `--agent <TAB>`                   | `dojops --get-completions agents`    |
| `--module <TAB>` / `--tool <TAB>` | `dojops --get-completions modules`   |

### Not completed

- `--file <TAB>` / `-f <TAB>` — shell's built-in file path completion (default behavior)
- Free-text prompts (positional arguments)
- `--version`, `-V`, `--help`, `-h` — no value to complete

### End-of-flags (`--`)

After a bare `--` token, completion scripts stop offering flag completions. Only commands/subcommands or file path completion apply.

---

## Shell Script Behavior

### Bash

- Uses `complete -F` with a `_dojops()` function
- Parses `COMP_WORDS` and `COMP_CWORD` for context
- Walks command tree: position 1 = command, position 2 = subcommand, position 3 = sub-subcommand (config profile only)
- Current word starting with `--` triggers flag completions
- Dynamic calls wrapped in 2-second timeout
- Requires bash-completion (available on most systems)

### Zsh

- Uses `compdef` with `_dojops()` function
- Descriptions alongside completions (e.g., `plan:Decompose goal into executable tasks`)
- Groups completions by category (commands, flags, values)
- Same `--get-completions` for dynamic values
- Same 2-second timeout for dynamic calls

### Fish

- Uses `complete -c dojops` declarations (one per completion)
- Conditions via `__fish_use_subcommand` and `__fish_seen_subcommand_from`
- Built-in descriptions per completion entry
- Same `--get-completions` for dynamic values
- Same 2-second timeout for dynamic calls

### Error handling

- All dynamic `--get-completions` calls wrapped in 2-second timeout
- If the call fails, times out, or returns non-zero: silently return no dynamic completions
- Completion functions never print errors to stderr during tab completion

---

## Install Locations

### `dojops completion install` behavior

1. **Detect shell**: explicit argument (e.g., `install bash`), or `$SHELL` env var basename
2. **Write to standard location**:
   - Bash:
     - macOS with Homebrew: `$(brew --prefix)/etc/bash_completion.d/dojops`
     - Otherwise: `~/.bash_completion.d/dojops` (create dir if needed)
   - Zsh: `~/.zsh/completions/_dojops` (create dir if needed)
   - Fish: `~/.config/fish/completions/dojops.fish` (create dir if needed)
3. **Print result**: success message with file path
4. **Manual steps** (printed, never auto-applied):
   - Bash: `Restart your shell or run: source ~/.bashrc`
   - Zsh: if `~/.zsh/completions` not in fpath, print: `Add to ~/.zshrc: fpath=(~/.zsh/completions $fpath); autoload -Uz compinit && compinit`
   - Fish: `Completions will be available in new shell sessions.`
5. **Overwrite existing**: print "Updated" instead of "Installed"
6. **Detection failure**: print error listing supported shells and exit non-zero

---

## `--get-completions` Implementation

- Intercepted early in `index.ts` (after `parseGlobalOptions`, before command dispatch)
- Prints newline-separated values to stdout, exits with code 0
- No LLM calls, no heavy initialization — only imports what's needed
- Unknown type: print nothing, exit 0
- Sources:
  - `providers`: hardcoded list (openai, anthropic, ollama, deepseek, gemini, github-copilot)
  - `agents`: reads `ALL_SPECIALIST_CONFIGS` from `@dojops/core` + discovers custom agents from `.dojops/agents/`
  - `modules`: reads built-in module directory names from `@dojops/runtime` + discovers user modules from `.dojops/modules/`

---

## Testing

Unit tests (`packages/cli/src/__tests__/completion.test.ts`):

- `completion bash` returns script containing `_dojops` function and `complete -F`
- `completion zsh` returns script containing `compdef _dojops dojops`
- `completion fish` returns script containing `complete -c dojops`
- `completion install` writes to correct paths per shell (mocked fs)
- `--get-completions providers` returns all 6 provider names
- `--get-completions agents` returns agent names
- `--get-completions modules` returns module names
- `--get-completions unknown` prints nothing and exits 0
- Unknown shell argument prints error and exits non-zero
- `completion` with no argument prints usage and exits non-zero

No integration tests spawning actual shells (fragile in CI). Manual QA for real shell testing.

---

## Documentation

- `docs/cli-reference.md` — add `completion` command section
- `README.md` — add shell completion setup to post-install instructions
- `dojops-doc/` — add completion setup page or section in installation guide
