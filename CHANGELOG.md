# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.2] - 2026-03-27

### Added

- **MCP server mode**: DojOps can now act as an MCP server for external CLI agents (Claude Code, Gemini CLI, GitHub Copilot, OpenClaw). Run `dojops serve --mcp` or `npx @dojops/mcp` to expose 9 tools over stdio transport: `generate`, `plan`, `scan`, `debug-ci`, `diff-analyze`, `chat`, `list-agents`, `list-skills`, `repo-scan`
- **Provider isolation enforcement**: Model routing rules can no longer cross provider boundaries. `isModelCompatibleWithProvider()` validates that model names match their configured provider using known prefix patterns. Routing rules that reference a model from a different provider are skipped with a warning

### Fixed

- **Graceful shutdown**: API server now calls `server.closeAllConnections()` after the 30-second drain period to force-close lingering keep-alive connections
- **Verification error details**: Failed verification tasks now display the actual error messages (up to 5 per task) in the summary instead of just pass/fail counts

## [1.2.1] - 2026-03-26

### Fixed

- **Path traversal prevention**: `check.ts` and `binary-verifier.ts` now reject `..` segments in user-supplied paths
- **Hub download hash hard-fail**: Hub skill downloads fail if SHA-256 hash doesn't match; `--allow-unverified` flag for explicit opt-out
- **Non-bypassable credential denylist**: Policy engine credential patterns can no longer be overridden by user config
- **Timer leak in planner executor**: `Promise.race` in wave execution now clears timeout timers on completion
- **ReDoS guard for user-supplied regex**: Planner rejects regexes that exceed a complexity threshold
- **JSON.parse try/catch for LLM tool arguments**: Malformed JSON in tool call arguments no longer crashes the agentic loop
- **Context7 opt-in semantics**: Corrected `DOJOPS_CONTEXT_ENABLED` check across 4 CLI files
- **Deduplicate `isAnalysisIntent`**: Single source of truth in `generate.ts`, removed duplicates from `chat.ts`
- **`stripCodeFences` multi-block extraction**: Now extracts all fenced blocks instead of only the first
- **Gemini tool result name mapping**: Tool results now use `callId` lookup instead of assuming positional correspondence
- **Ollama `maxTokens` support**: `num_predict` option now passed through to Ollama API
- **FallbackProvider streaming corruption**: Guard prevents partial chunks from corrupting fallback responses
- **Agent router keyword overlap**: Removed 23 overlapping/generic keywords from 12 specialist agents to reduce routing ambiguity
- **Agent router `matchRatio` bias**: Denominator capped at `Math.max(keywords.length, 10)` to prevent small-keyword-list agents from dominating
- **Agent router LLM confidence**: `routeWithLLM()` returns real keyword-based confidence instead of hardcoded 1.0
- **Agentic stall detection**: Changed from per-call to per-iteration signatures to detect multi-call repeating patterns
- **`executeWithSemaphore` error handling**: Wave executor collects all errors instead of fail-fast, so parallel tasks aren't abandoned
- **`routeWithSpinner` structured output check**: Uses shared `isStructuredOutput()` helper instead of inline duplicate
- **ArgoCD skill keyword collision**: Removed generic "gitops" keyword that captured unrelated prompts

### Added

- **Shell scripting skill** (`shell.dops`): Bash/sh script generation with ShellCheck verification
- **Python scripting skill** (`python.dops`): Python automation script generation
- **PowerShell scripting skill** (`powershell.dops`): PowerShell script generation for Windows automation
- **Packer skill** (`packer.dops`): HashiCorp Packer machine image definitions with `packer validate` verification
- **Primary keywords for agent routing**: High-signal keywords get a +0.1 confidence boost per match
- **Project context bonus for agent routing**: +0.15 confidence boost when agent domain matches `dojops init` project domains

## [1.2.0] - 2026-03-25

### Added

- **API streaming (SSE)**: `/api/generate` and `/api/chat` endpoints now support Server-Sent Events via `Accept: text/event-stream` header or `stream: true` in the request body. Streams `agent`, `chunk`, and `done` events with JSON payloads, terminated by `[DONE]`. Backwards-compatible — clients that don't request streaming get the existing JSON response
- **Skill dependency graph**: `.dops v2` skills can declare dependencies on other skills via a `dependencies` array in frontmatter. `resolveSkillDependencies()` produces execution order with missing-required and missing-optional reporting
- **Skill versioning and manifest**: Hub-installed skills are tracked in `skill-manifest.json` with name, version, source, install date, and SHA-256 hash. `checkForUpdates()` compares local versions against the Hub for selective upgrade
- **Cost budget alerts**: Configurable daily and monthly cost thresholds in `config.json` under `budget`. `TrackingProvider` checks spend after each LLM call, warns at 80%, and optionally blocks at 100% when `action: "block"` is set
- **Team/org config sharing**: `.dojops/team.json` provides shared team config (provider defaults, model routing, budgets) committed to the repo. Loaded between global and local config. Tokens are stripped from team config for security
- **Webhook notifications for background jobs**: `POST /api/auto` accepts optional `webhookUrl` parameter. When a background run completes, the result is POSTed to the webhook with HMAC-SHA256 signature (`X-DojOps-Signature`) for verification
- **Scan baseline and suppressions**: `.dojops/scan-baseline.json` records accepted findings by fingerprint (SHA-256). `filterBaselined()` removes known findings from scan results. `createBaselineFromFindings()` generates baselines from current scan output
- **Skill testing framework**: `skill-tester.ts` provides `loadFixtures()` (from `.dojops/skill-tests/<name>.json`), `validateSkillFile()` (schema checks without LLM), and `testOutputAgainstFixture()` (regex-based expected/forbidden pattern matching)
- **Offline skill cache**: `dojops skills cache` syncs installed skills to a local cache. Supports `--list`, `--bundle <path>` (export for air-gapped environments), and `--import <path>` (import from bundle). Hub search skips network in `--offline` mode
- **Multi-file skill output**: `splitMultiFileOutput()` splits LLM output containing `--- FILE: path ---` or `# FILE: path` markers into separate files. `isMultiFileSkill()` detects multi-output skills from the files spec

## [1.1.9] - 2026-03-24

### Added

- **Skill trust boundary (5-layer defense)**: Custom skills from Hub or user directories are wrapped in a controlled envelope so they serve as supplementary guidance, not authoritative system overrides. Includes data isolation via XML boundaries, injection detection at load time, and SHA-256 sidecar verification for hub-installed skills
- **Auto agent validation cheatsheet**: System prompt now includes exact validation commands for 14 CLI tools (docker, terraform, kubectl, helm, actionlint, etc.) built dynamically from discovered binaries, preventing hallucinated flags like `docker build --dry-run`
- **`[TOOL NOT INSTALLED]` executor guard**: Tool executor detects exit code 127 (command not found) and returns a clear, non-retriable error message telling the agent to stop and use `run_skill` instead
- **Auto agent premature-done prevention**: `validateBeforeDone` now rejects `done` calls when no files have been written to disk, and the agent loop nudges the LLM to use `write_file` after `run_skill`
- **Auto agent efficiency rules**: System prompt blocks global package installs, `.env` writes, unlisted CLI tools, and python-based YAML validation to reduce token waste
- **Hash-chained audit persistence**: `AuditPersistence` writes execution audit entries to `.dojops/audit.jsonl` as newline-delimited JSON with SHA-256 hash chains (each entry links to previous via `previousHash`, first entry uses `GENESIS`). Includes `verify()` for tamper detection
- **Zod config schema validation**: `DojOpsConfigSchema` validates `.dojops/config.yaml` at load time with graceful degradation — invalid fields are stripped with warnings, valid fields preserved
- **Multi-agent coordinator**: `AgentCoordinator` enables inter-task shared context, message passing, and handoff queues during plan execution. Wired into `--execute` and `/api/plan` routes
- **16 specialist agent system prompts**: All specialist agents now carry domain-specific system prompts with output format rules, tool awareness, and best practice guidelines for autonomous operation
- **Secret scanning in tool executor**: Generated output is scanned for leaked credentials (AWS keys, private keys, tokens) before being written to disk
- **LLM output redaction**: API key patterns and secrets in LLM responses are detected and masked before display

### Fixed

- **Auto agent not writing files to disk**: `run_skill` returns generated content as text but the agent would call `done` without using `write_file`. Workflow now explicitly states `run_skill` does NOT create files and the validation gate catches zero-file completions
- **`run_skill` validation failures**: Tool schema was opaque (`additionalProperties: true` with no listed properties). Now has explicit `prompt` (required), `existingContent`, and `outputPath` properties with descriptions
- **OpenAI `is_error` gap**: OpenAI API has no `is_error` field on tool messages so error flags were silently dropped. Error tool results now prefixed with `[TOOL ERROR]` for OpenAI-compatible providers
- **actionlint shellcheck dependency**: actionlint fails with cryptic JSON parse error when shellcheck is not installed. Fixed across all three usage paths: review-tool-map (`-shellcheck=`), github-actions.dops verification command, and auto agent cheatsheet
- **Model routing default**: `DOJOPS_MODEL_ROUTING` changed from opt-in (`=== "true"`) to default-on (`!== "false"`) with NoopProvider guard
- **HistoryStore unbounded growth**: Store now enforces a max-entries cap (default 500) and prunes oldest entries on write
- **Diff risk scoring edge cases**: `computeDiffRisk()` handles empty diffs and single-line changes without crashing
- **MCP client timeout handling**: `McpClientManager` properly cleans up stale connections and avoids hanging on unresponsive servers
- **Tool executor child process cleanup**: Spawned processes are killed on timeout instead of leaving orphans
- **Safe-exec `cp` removed from runtime and skill-registry**: Replaced inline shell wrappers with direct `node:child_process` calls to eliminate command injection surface

### Changed

- **Auto agent workflow rewritten**: Steps now emphasize: generate with `run_skill` → write to disk with `write_file` → repeat for all files → then `done`. Previously workflow was ambiguous about the write step
- **Auto agent text-only nudge expanded**: When the LLM stops emitting tool calls without writing files, a targeted nudge message is injected explaining that `run_skill` output must be persisted with `write_file`
- **Prompt compiler data boundaries**: Variable substitutions (`{context7Docs}`, `{projectContext}`, `{existingContent}`) now wrapped in `<data label="...">` XML tags so the LLM treats them as content, not instructions
- **Planner executor supports coordinator injection**: `PlannerExecutor` accepts optional `AgentCoordinator` in options for shared context between tasks during wave-based execution

## [1.1.8] - 2026-03-22

### Fixed

- **CLI parser missing 9 registered commands**: `secrets`, `learn`, `checkpoint`, `trust`, `untrust`, `cost`, `drift`, `fix-deps`, and `backup` were registered via `registerCommand()` but absent from the `KNOWN_COMMANDS` whitelist in `parser.ts`, causing them to be misrouted as generate prompts and rejected as "Unknown command"
- **CLI parser missing 6 subcommands**: `summary`, `patterns`, `rules`, `resolve`, `dismiss`, and `clear` were not in the `KNOWN_SUBCOMMANDS` set, preventing `dojops learn summary`, `dojops learn patterns`, etc. from being parsed correctly
- **Duplicate `serve` entry in `KNOWN_COMMANDS`**: Removed redundant entry

### Added

- **`dojops memory clear` subcommand**: Deletes all project notes in a single operation instead of removing one by one with `dojops memory remove <id>`
- **Help text for `dojops secrets`**: Full help with USAGE, SUBCOMMANDS (set, get, list, remove), OPTIONS, DESCRIPTION, and EXAMPLES sections
- **Help text for `dojops learn`**: Full help with USAGE, SUBCOMMANDS (summary, patterns, rules, resolve, dismiss), OPTIONS, DESCRIPTION, and EXAMPLES sections
- **Help text for `dojops tokens`**: Full help with USAGE, OPTIONS (--days, --graph, --by-command), DESCRIPTION, and EXAMPLES sections
- **Help text for `dojops backup`**: Full help with USAGE, SUBCOMMANDS (default, restore, list), OPTIONS, DESCRIPTION, and EXAMPLES sections
- **`memory clear` added to `dojops memory` help text**: Updated USAGE, SUBCOMMANDS, and EXAMPLES sections

## [1.1.7] - 2026-03-20

### Added

- **Semgrep and checkov in toolchain**: Both Python-based scanners are now installable via `dojops toolchain install semgrep checkov` using sandboxed venvs, bringing the toolchain to 16 tools
- **Post-install commands for system tools**: New `postInstallCommands` field on `SystemTool` interface allows tools to run setup steps after binary installation (e.g. trivy vulnerability DB download)
- **Trivy DB auto-download**: Trivy vulnerability database (~100 MB) is automatically downloaded after toolchain installation via `trivy image --download-db-only`
- **Chat session history on resume**: Resuming a chat session now displays the last 10 messages with role labels, timestamps, and formatted content instead of just "loaded X messages"
- **Skill fallback system**: When no built-in or installed skill matches a prompt, DojOps searches the Hub marketplace and falls back to Context7-augmented LLM generation before routing to agents
- **Generalized pip tool installer**: `installPipTool()` replaces the ansible-specific installer, supporting any Python tool with `archiveType: "pipx"` in sandboxed venvs
- **New CLI commands**: `dojops backup`, `dojops learn`, `dojops secrets` for project backup management, learning resources, and secret scanning

### Fixed

- **Toolchain migration when both directories exist**: `migrateToolchainDir()` now merges binaries and registry entries from `~/.dojops/tools/` into `~/.dojops/toolchain/` instead of silently skipping migration
- **Doctor command shows correct toolchain paths**: `~/.dojops/tools/bin/` references updated to `~/.dojops/toolchain/bin/` in doctor output
- **Semgrep and checkov marked as always-relevant**: Both scanners now appear in `dojops doctor` output for all projects, matching trivy and gitleaks behavior
- **Packer validation parser**: Added `packer-validate` output parser for HCL validation results

### Changed

- **System tools registry expanded to 16 tools**: Added semgrep, checkov definitions alongside existing 14 tools
- **`BINARY_TO_SYSTEM_TOOL` mapping updated**: Added semgrep and checkov binary-to-tool mappings

## [1.1.6] - 2026-03-20

### Fixed

- **Scope policy rejects root-level files with `**/`glob patterns**:`matchesSinglePattern()`now handles`**/`prefix for root-level files (e.g.`**/\*.yml`matches`prometheus.yml`). Previously, skills like Prometheus and Pulumi failed with "blocked by scope policy" when writing to root-level output paths
- **Ansible plan execution failures**: Multi-file output normalization, `.gitkeep` filtering, and directory-only path guards across runtime, binary-verifier, and safe-executor layers
- **Analysis-only plan tasks incorrectly validated as YAML**: Tasks that produce analysis text (not config files) are now detected and skip structural validation
- **Analysis tasks writing empty files**: Guard added to prevent file writes when task output is analysis/commentary rather than generated config
- **`detectOutputPathPrefix` too narrow**: Broadened to strip any common non-structural first segment from LLM output keys, not just the skill name
- **Verify files normalized before peer file merge**: Moved normalization to after `mergePeerFiles()` so peer file paths are also stripped of output prefixes
- **`_peerFiles` lost during self-repair loop**: SafeExecutor now preserves `_peerFiles` from initial output through repair iterations
- **Token usage not displayed after plan execution**: Removed verbose-only guard so token counts always show in non-JSON mode
- **Token counts lost between PlannerExecutor and SafeExecutor**: `_usage` is now embedded in PlannerExecutor task output and extracted in `apply.ts` for SafeExecutor accumulation

### Changed

- **15 skill files hardened to v2.2.0**: Pulumi `fileFormat` corrected from `raw` to `json`; Jenkinsfile fake binary verification removed; CloudFormation `cfn-lint` verification added; scope patterns tightened for GitHub Actions, Grafana, ArgoCD, OTel Collector, Docker Compose, Systemd, and Helm; flat directory structure rules added where applicable
- **`.gitkeep` filtered at all layers**: Normalization, validation, verification temp dirs, and binary-verifier `writeFilesToTmpDir()` all skip `.gitkeep`/`.keep` files and directory-only paths

## [1.1.5] - 2026-03-20

### Added

- **5 new built-in skills**: Pulumi (`pulumi.dops`), ArgoCD (`argocd.dops`), CloudFormation (`cloudformation.dops`), Grafana (`grafana.dops`), OpenTelemetry Collector (`otel-collector.dops`) — total built-in skills now 18
- **Secret scanning before file writes**: `scanForSecrets()` detects 9 secret patterns (AWS keys, GitHub tokens, API keys, private keys, passwords) with severity levels (error/warning) and placeholder awareness. Integrated into `ToolExecutor` to block accidental secret leaks
- **SARIF 2.1.0 output format**: `packages/scanner/src/sarif.ts` converts scan findings to SARIF for integration with GitHub Code Scanning, VS Code, and other SARIF-compatible tools
- **Compliance scanning**: `packages/scanner/src/compliance.ts` checks for SOC2, HIPAA, and PCI-DSS compliance patterns across IaC and CI/CD configurations
- **Infrastructure cost estimation**: `dojops cost` command estimates cloud resource costs from Terraform/Kubernetes/Docker Compose configs using provider pricing data
- **Infrastructure drift detection**: `dojops drift` command detects configuration drift via `terraform plan` and `kubectl diff` with auto-detection, JSON output, and audit logging
- **Dependency auto-remediation**: `dojops fix-deps` command runs `npm audit fix`, handles breaking changes with `--force` flag, pnpm lockfile conflict warnings, and detailed reporting
- **Audit log export**: `dojops history export` exports audit logs in JSON, CSV, or syslog format with date range filtering
- **Skills management commands**: `dojops skills update`, `dojops skills export`, `dojops skills import` for skill lifecycle management with SHA-256 integrity verification on download
- **Offline mode support**: `packages/cli/src/offline.ts` enables graceful degradation when no network connectivity is available
- **HTTP(S) proxy support**: `packages/core/src/llm/proxy.ts` adds proxy configuration via `HTTPS_PROXY`/`HTTP_PROXY` environment variables for LLM provider connections
- **Shared `resolveToolName()` utility**: `packages/sdk/src/resolve-tool-name.ts` extracts duplicated skill name resolution logic into a single shared function
- **Test coverage for new commands**: 57 new tests across 6 test files covering cost, drift, fix-deps, audit-export, skills-extra, and offline commands
- **Dockerfile health check**: Added `HEALTHCHECK` instruction to production Docker image
- **SIGTERM handler**: CLI now handles SIGTERM for graceful shutdown in containerized environments

### Changed

- **Command injection blocklist hardened**: `isDangerousCommand()` in `ToolExecutor` now blocks PowerShell patterns (`Invoke-Expression`, `Start-Process`), environment/interpreter manipulation (`env`, `export`, `source`, `eval`), base64 pipe patterns, and process substitution. Network commands (curl, wget, nc) now blocked outright instead of warned
- **History store secret redaction**: `HistoryStore` now redacts secrets from stored data via `redactSecrets()` and `redactDeep()` before persisting to JSONL
- **Background auto runs hardened**: Background runs enforce 1-hour TTL, 100-run cap, and apply `deniedWritePaths` matching CLI restrictions (`.ssh`, `.gnupg`, `.aws`, `.config`, `.env`)
- **API server auth enforcement**: `dojops serve` now refuses to start without API key authentication (matching `server.ts` behavior), supports both `--no-auth` and `--unsafe-no-auth` flags
- **Vault key security**: Random 32-byte vault key generated at `~/.dojops/vault-key` with `0o600` permissions, legacy key migration supported
- **Async audit logging**: `appendAudit()` in `state.ts` now uses async I/O instead of synchronous spin-wait
- **Chat session optimization**: `ChatSession` refactored to extract `prepareRequest()` and `finalize()` from duplicated `send()`/`sendStream()` logic. Agent routing uses keyword-first matching with LLM fallback only below 0.4 confidence
- **Prompt validation middleware**: API routes now validate prompts for injection patterns before processing
- **Token budget middleware**: API returns HTTP 429 when estimated token usage exceeds configured budget
- **Trust store integrity**: Trust store written with `0o600` permissions and HMAC-SHA256 signatures. `discoverWorkspaceConfigs()` now extracts `envPassthrough` from MCP config and displays in trust prompt
- **MCP connection timeout**: MCP client connections now have a 30-second timeout via `Promise.race`
- **YAML DoS protection**: All `yaml.load()` calls now use `{ maxAliasCount: 100 }` to prevent billion laughs attacks (verify, dojops-md-parser, policy)
- **`@file` expansion hardened**: Path traversal guard limits `../` to 3 levels and blocks sensitive directories (`.ssh`, `.gnupg`, `.aws`, `.config/gcloud`)
- **Run ID validation**: `isValidRunId()` rejects path traversal characters (`/`, `\`, `..`) to prevent directory traversal via run IDs
- **Shell completions updated**: Fish completions fully rewritten with all new commands. Zsh and Bash completions updated with skills as primary terminology
- **Skill keyword routing expanded**: `SKILL_KEYWORDS` map in `generate.ts` and `TOOL_LIBRARY_MAP` in Context7 now include all 5 new skills
- **Generic error responses**: Chat API returns `"Internal server error"` instead of leaking internal error details to clients
- **Background child env filtering**: `dojops auto --background` filters sensitive environment variables before spawning child processes
- **CloudFormation skill**: Set `child_process: none` (generation only, no execution)
- **OTel Collector skill**: Narrowed detection paths to reduce false positives
- **Drift audit status**: Uses descriptive `"drift-detected"` / `"no-drift"` status instead of generic `"success"`
- **Documentation**: Updated all references from "13 built-in skills" to "18 built-in skills" across docs, READMEs, and package descriptions. Added CLI reference entries for all new commands

## [1.1.4] - 2026-03-19

### Fixed

- **`memory` command routing broken by subcommand registration**: `registerSubcommand()` replaced the parent function handler with a Map, discarding the fallback. Commands like `dojops memory list` returned "Unknown command" because the Map had no `"list"` key. The parent handler is now preserved under the `""` key and `resolveCommand()` falls back to it for unregistered subcommands
- **`review` rejects null values in Zod schema**: DeepSeek (and potentially other providers) returns `"line": null` in review findings, but `z.number().optional()` only accepts `number | undefined`. Added `.nullable()` to `line` and `toolSource` fields in `ReviewFindingSchema` and the CLI formatter types
- **`analyze diff` strips inline diff content**: The argument filter `!a.startsWith("-")` removed diff content starting with `---`/`-` (valid unified diff syntax). Switched to a whitelist approach that only filters known CLI flags. Renamed `--file` to `--diff-file` to avoid conflict with the global `--file` option

### Added

- **Command registry test coverage**: New `command-registry.test.ts` verifying that `registerSubcommand` preserves parent handler fallback behavior

## [1.1.3] - 2026-03-18

### Added

- **Parallel task execution (semaphore pool)**: Replaced fixed-size chunk batching in `PlannerExecutor` with a semaphore-based concurrency pool. New tasks start the instant any slot frees up instead of waiting for an entire batch to complete. Add `--parallel <n>` flag to `dojops apply` to control concurrency (default: 3)
- **Background agent delegation**: `dojops auto --background <prompt>` spawns a detached agent process and returns immediately with a run ID. Results stored in `.dojops/runs/<id>/`. New `dojops runs list|show|clean` commands to manage background runs. API supports `background: true` in `POST /api/auto` (returns HTTP 202) with `GET /api/auto/runs/:id` for status polling
- **Auto-enriched persistent memory**: `dojops auto` now automatically injects memory context from previous sessions into the agent's system prompt and records completed tasks to the memory database. Enables continuation detection (recognizes follow-up tasks) and error pattern awareness. Toggle with `dojops memory auto on|off` (enabled by default). New `dojops memory errors` command lists learned error patterns
- **Seamless multi-provider in-session switching**: New `/provider [name]` slash command in interactive chat swaps the LLM provider mid-session while preserving full message history. Interactive picker when no name given. `ChatSession.setProvider()` and `setRouter()` enable programmatic switching. Message format is already provider-agnostic — no normalization needed
- **Voice input via whisper.cpp**: Local speech-to-text using whisper.cpp (no API calls, fully offline). `/voice` push-to-talk command in interactive chat records audio via SoX, transcribes locally, and sends as a message. `--voice` flag on `dojops plan` and `dojops auto` enables speaking prompts instead of typing. Installable via `dojops toolchain install whisper-cpp` (cmake-based build with proper shared library handling). Recording uses Enter/Space to stop instead of Ctrl+C — SIGINT is intercepted during recording to avoid killing the chat session. whisper-cpp is forced to global scope (shared 142MB model). `dojops doctor` shows voice dependency status

- **MCP (Model Context Protocol) support**: New `@dojops/mcp` package enabling the autonomous agent to call tools from external MCP servers (databases, cloud APIs, GitHub, etc.). Supports both `stdio` (local subprocess) and `streamable-http` (remote endpoint) transports. MCP is a Linux Foundation standard.
- **MCP config system**: Project-level (`.dojops/mcp.json`) and global (`~/.dojops/mcp.json`) MCP server configuration with Zod validation and automatic merging (project overrides global by server name)
- **MCP CLI commands**: `dojops mcp list` (show servers and connection status), `dojops mcp add` (interactive server setup), `dojops mcp remove` (remove a server)
- **MCP tool namespacing**: External tools appear as `mcp__<server>__<tool>` in the agent loop, matching the Claude Code convention. The `ToolExecutor` dispatch chain: built-in tools → skill resolution → MCP dispatcher → unknown tool error
- **MCP agent loop integration**: `dojops auto` dynamically loads MCP config, connects servers at start, merges MCP tools with built-in tools, and disconnects in a `finally` block. MCP is optional — failures are non-fatal
- **Streaming output for Anthropic provider**: `generateStream()` using `client.messages.stream()` — tokens appear progressively instead of blocking behind a spinner. Falls back to non-streaming for structured output (schema requests)
- **Streaming output for GitHub Copilot provider**: `generateStream()` delegating to shared `openaiCompatGenerateStream()` — all 4 OpenAI-compatible providers (OpenAI, DeepSeek, Copilot, Ollama) now support streaming
- **Streaming in generation commands**: `dojops "prompt"` now streams tokens to the terminal in real-time when the provider supports it (instead of showing a spinner for 10-30s). Streaming is skipped for structured output (skills) and file-writing modes
- **Shared stream renderer utility**: `createStreamRenderer()` in `@dojops/cli` encapsulates ANSI line overwriting for reusable streaming UX across commands

## [1.1.2] - 2026-03-17

### Added

- **Agentic mode: CLI binary discovery**: The `dojops auto` system prompt now probes PATH for ~35 DevOps binaries (terraform, kubectl, helm, docker, etc.) and lists available tools, so the LLM knows which CLI commands it can run
- **Agentic mode: skill listing in system prompt**: Available DojOps skills are now listed in the agent's system prompt with exact names, preventing the LLM from inventing skill names
- **Dynamic Zod schema for task decomposition**: `createTaskGraphSchema()` constrains the `tool` field to a `z.enum()` of valid skill names, catching hallucinated names at parse time
- **Fuzzy skill name resolution**: Both `PlannerExecutor` and `ToolExecutor` now strip common LLM-hallucinated suffixes (`-chart`, `-config`, `-file`, `-template`, `-manifest`, `-setup`, `-yaml`, `-yml`) and try prefix matching before failing
- **Auto-redirect skill-as-tool calls**: When the LLM calls a skill name directly as a tool (e.g. `dockerfile` instead of `run_skill`), `ToolExecutor` auto-redirects to `run_skill` instead of returning "Unknown tool"

### Fixed

- **`search_files` fails on path-containing patterns**: Patterns like `terraform-iac/**/*.tf` always returned zero results because `find -name` only matches basenames. Added `normalizeSearchPattern()` to extract directory components and adjust the search path
- **`search_files` misleading "No search criteria" error**: When search criteria was provided but no files matched, the error message said "No search criteria provided", causing the LLM to waste iterations retrying with different argument formats. Now returns accurate "No files found matching X" message
- **Raw JSON displayed as agent summary**: When the LLM returned the `done` tool call as truncated JSON text, `extractSummaryFromContent()` fell through to displaying raw JSON. Added regex fallback for truncated/malformed JSON and a `cleanDisplayText()` safety net at display time
- **`search_files` tool description encouraged broken patterns**: The pattern parameter examples (`'**/*.ts'`, `'src/**/*.yaml'`) included path separators that `find -name` cannot match. Updated description to use simple filename globs and direct users to the `path` parameter for subdirectories

### Changed

- **Default max iterations increased from 20 to 50**: Complex multi-step tasks frequently hit the 20-iteration ceiling. Default increased to 50 for both `AgentLoop` and the CLI `--max-iterations` flag

## [1.1.1] - 2026-03-14

### Added

- **`-f` / `--file` support for `dojops auto`**: The `auto` command now accepts `-f <file>` to read prompts from files, matching the behavior of `plan` and `generate`. Inline and file prompts can be combined
- **Dashboard: history shows executed commands**: History entries now display the prompt/command text alongside type and status. Supports all entry types (generate, plan, auto, debug-ci, diff, scan, chat, review)
- **Dashboard: pagination on all tables**: Every table and list across all dashboard tabs now has pagination controls — Overview (recent activity, most used commands, failure reasons), Security (issues, scan history), Audit (command distribution, recent entries), and History
- **Dashboard: all entry types in history filter**: The history type dropdown now includes Auto, Scan, Chat, and Review filters

### Fixed

- **`dojops serve` exits immediately after startup**: The HTTP server shut down as soon as it started because `process.exit(0)` fired when the non-blocking `app.listen()` returned. `serveCommand` now awaits a never-resolving promise to keep the process alive until SIGINT/SIGTERM
- **`dojops auto` outputs text instead of creating files**: When the LLM returned all content as text without using tools (0 tool calls, 1 iteration), the agent loop treated it as success. The system prompt now explicitly requires tool use, and the loop re-prompts the LLM if the first response has no tool calls
- **`dojops auto` blocks writes to non-allowlisted paths**: File writes failed with "not a recognized DevOps file" for project-specific directories (e.g. Helm charts in `nextjs-app/`). Autonomous mode now allows writes anywhere under the working directory since the user explicitly opted in
- **`dojops auto` summary displays raw JSON**: When the LLM returned the `done` tool call as JSON text instead of a native function call, the raw JSON was shown as the summary. The agent loop now parses JSON content and extracts the human-readable summary
- **`dojops auto` displays absolute file paths**: Created/Modified file lists showed full absolute paths. Now displays paths relative to the working directory
- **`dojops auto` shows JSON in progress output**: Raw JSON from the LLM was printed in the "thinking" progress line. The callback now skips JSON content
- **Dashboard sidebar logo too large**: Reduced logo max-width from 140px to 100px
- **Dashboard history route missing "auto" type**: The `ALLOWED_TYPES` set in the history route handler now includes "auto" entries
- **Dashboard history empty after CLI usage**: The history tab only showed API-originated entries because it read from the in-memory `HistoryStore`. CLI commands write to `.dojops/history/audit.jsonl` instead. The history route now reads both sources and merges them, so CLI-executed commands (generate, plan, apply, auto, scan) appear in the dashboard

## [1.1.0] - 2026-03-14

### Added

- **Autonomous Agent Loop (ReAct Pattern)**: New `dojops auto "prompt"` command that iteratively reads files, makes changes, runs commands, and verifies — all autonomously. Replaces the one-shot generation model with an observe → think → act cycle. The LLM can call 7 tools (`read_file`, `write_file`, `edit_file`, `run_command`, `run_skill`, `search_files`, `done`) and loop until the task is complete or the iteration limit is reached
  - **Native Tool-Calling**: `LLMProvider` interface extended with optional `generateWithTools()` method. OpenAI, Anthropic, and Gemini use provider-native tool-calling APIs; Ollama uses a prompt-based fallback that injects tool descriptions into the system prompt and parses JSON output
  - **ToolExecutor** (`@dojops/executor`): Dispatches tool calls to sandboxed operations enforced by `ExecutionPolicy`. Supports file read/write/edit with policy checks, shell command execution with timeout, skill invocation, and glob/grep file search. Output truncated at 32KB
  - **AgentLoop** (`@dojops/session`): ReAct loop controller with configurable max iterations (default 20), token budget tracking, context compaction after 15 messages, and progress callbacks. Falls back to prompt-based tool calling for providers without native support
  - **`POST /api/auto` Endpoint**: REST API for autonomous agent mode with request validation, policy configuration, and history storage
  - **Chat `/auto` Command**: Bridge command in interactive chat mode to invoke autonomous agent inline
  - **`--max-iterations`** and **`--allow-all-paths`** flags on `dojops auto`
  - 46 new tests across core (tool types, prompt-tool-calling), executor (ToolExecutor), and session (AgentLoop)
- **Agent-Aware Plan Execution**: The task planner now assigns specialist agents to tasks during goal decomposition. Each task in the `TaskGraph` gets an optional `agent` field (e.g., `terraform-specialist`, `kubernetes-specialist`) assigned by the LLM based on domain relevance. During execution, the assigned agent's system prompt is injected as domain context into the skill's LLM call via `_agentContext`, giving the LLM both specialist expertise and skill-specific generation instructions. Backward-compatible — existing plans without agent assignments still work
- **Chat Progress Phases**: Chat TUI now displays phase-by-phase progress during message processing (Routing → Compacting → Generating → Done) with colored indicators showing the current phase, active agent name, and provider/model info
- **Visible Auto-Compaction**: When conversation history exceeds the context window, a visible "Conversation compacted" notification shows how many messages were summarized and retained, replacing the previously silent compaction
- **LLM-Based Chat Routing**: Chat sessions now use LLM intent classification (`routeWithLLM()`) to select the best specialist agent instead of keyword matching. Falls back to keyword-based `route()` when LLM routing fails
- **Chat Project File Context**: Chat agents now receive actual DevOps file contents (CI/CD, Dockerfile, Terraform, Ansible, etc.) from the project, enabling specific file-level analysis instead of generic advice. Files are discovered via `discoverDevOpsFiles()` and injected into the system prompt
- **Analysis Intent Detection**: `dojops "prompt"` now detects analysis/review questions (e.g., "what do you think about our workflows?") and routes them to specialist agents for natural language analysis instead of incorrectly triggering skill file generation
- **Formatted File Output**: When skills generate `{ "files": { ... } }` JSON output, the CLI now renders each file as a labeled code block with syntax highlighting instead of dumping raw JSON
- **Shell Auto-Completion**: Tab completion for Bash, Zsh, and Fish shells. Covers all 31 commands, subcommands, global/command-specific flags, and dynamic value completions for `--provider`, `--agent`, and `--skill` flags
  - `dojops completion bash|zsh|fish` — print completion script to stdout
  - `dojops completion install [shell]` — auto-detect shell and install to standard location
  - Hidden `--get-completions <type>` flag for dynamic provider/agent/skill lookups at tab-completion time
  - 3-level nesting support (`config profile create|use|delete|list`)
  - Command-specific flag completions for `plan`, `apply`, `scan`, `serve`, `chat`, `auto`
  - 2-second timeout on dynamic completions to prevent shell hang
- **Token Usage Analytics** (`dojops tokens`): Track and analyze LLM token usage per provider, command, and time period with daily and total summaries
- **Smart Output Compression**: Intelligent output formatting that compresses verbose LLM responses while preserving key information
- **Model Aliases**: Configure short model aliases (e.g., `fast`, `smart`) mapping to provider-specific models via `~/.dojops/config.json`
- **Thinking/Reasoning Levels**: `--thinking` flag with extended thinking/reasoning modes for compatible providers (Anthropic, DeepSeek)
- **Tee/Recovery for Tool Failures**: Automatic retry with fallback provider when primary LLM provider fails during tool execution
- **Log Deduplication**: Deduplicate repeated audit log entries to reduce storage and improve readability
- **Opportunity Detection** (`dojops insights`): Analyze project history to surface actionable insights across efficiency, security, quality, and cost categories. Supports category filtering and `--all` flag
- **Config Backup & Restore**: `dojops config backup` saves current config as a timestamped snapshot; `dojops config restore` restores from a backup
- **Config Apply & Export**: `dojops config apply <file>` imports config from a YAML/JSON file; `dojops config export <file>` exports current config
- **Structured JSON Output**: `--output json` support added to `cron`, `rollback`, and `clean` commands
- **Encrypted Secrets Vault**: AES-256-GCM encrypted vault for API tokens, replacing plaintext storage in `config.json`. Scrypt key derivation from passphrase or `DOJOPS_VAULT_KEY` environment variable. Commands: `dojops provider add` auto-encrypts, `dojops config vault-status` shows vault state
- **Memory System** (`dojops memory`): Persistent project notes with keyword-based search and RAG-style injection into LLM context. SQLite-backed storage in `.dojops/memory/dojops.db`. Subcommands: `list`, `add`, `remove`/`rm`, `search`. Supports `--category` and `--keywords` flags
- **Error Pattern Learning**: Automatic error fingerprinting and deduplication across commands. Records error patterns from task failures, tracks occurrence counts, and supports resolutions via `dojops memory add "fix: ..."`
- **Enhanced Insights**: `dojops insights` now analyzes error patterns (recurring errors, module-specific failure concentrations) and memory usage, suggesting corrective actions

### Fixed

- **Chat Agents Missing Project Context**: System messages containing project context, chat-mode instructions, and conversation summaries were silently stripped by all LLM providers (OpenAI, Anthropic, Ollama, Gemini, DeepSeek). `SpecialistAgent` now merges system messages from the messages array into the system prompt before sending to providers
- **Analysis Questions Triggering File Generation**: Prompts like "what do you think about our github workflows?" matched SKILL_KEYWORDS and routed to the github-actions skill (which generates new files) instead of a specialist agent. Intent detection now skips skill auto-detection for analysis/review questions

### Changed

- **Super-Agent Uses Autonomous Mode**: `dojops-super-agent` now invokes `dojops auto` instead of `dojops plan --execute --yes` for ticket processing, gaining iterative file reading, targeted edits, and error recovery capabilities
- **`dojops auto` Evolved to Full Agent Mode**: Transformed from a thin `plan --execute --yes` wrapper into an autonomous agent with iterative tool-use (ReAct pattern). Now builds a `ToolExecutor` with policy enforcement, loads skills, and runs an `AgentLoop` with rich TUI output
- `DopsModuleV2` renamed to `DopsSkill` (only skill type)
- `DopsFrontmatterV2` renamed to `DopsFrontmatter`
- `parseDopsFileAny()` renamed to `parseDopsFile()` (v2-only)
- `parseDopsStringAny()` renamed to `parseDopsString()` (v2-only)
- `createToolRegistry()` renamed to `createSkillRegistry()`

### Removed

- `DopsRuntime` v1 class, v1 prompt compiler (`compilePrompt`)
- `CustomTool` class and `tool.yaml` / `plugin.yaml` manifest discovery
- `docs/TOOL_SPEC_v1.md` specification document
- All deprecated `Plugin*` type aliases (`PluginManifest`, `PluginSource`, `PluginEntry`, etc.)
- `parseDopsFile()` and `parseDopsString()` v1-only parsers
- v1 schema types: `InputFieldDef`, `FileSpec` (v1), `DopsFrontmatterSchema` (v1)

### Breaking Changes

- **Renamed "tools"/"modules" to "skills" across the entire platform** — `.dops` files are now called "skills". `@dojops/tool-registry` → `@dojops/skill-registry` (through intermediate `module-registry` rename)
- **Renamed types** — `BaseTool` → `BaseSkill`, `ToolRegistry` → `SkillRegistry`, `ModuleEntry` → `SkillEntry`, `ModulePolicy` → `SkillPolicy`, `DevOpsTool` → `DevOpsSkill`, `ToolOutput` → `SkillOutput`, `DopsModule` → `DopsSkill`
- **CLI command rename** — `dojops tools` / `dojops modules` → `dojops skills` (no legacy alias)
- **CLI flag rename** — `--tool` / `--module` → `--skill`
- **Directory paths** — `.dojops/tools/` and `.dojops/modules/` → `.dojops/skills/`, `packages/runtime/modules/` → `packages/runtime/skills/`
- **Hub, docs, and marketing site** updated to use "skills" terminology throughout
- **Removed `.dops v1` format support** — all skills must use `dops: v2` frontmatter
- **Removed `tool.yaml` custom tool manifests** — create custom skills as `.dops v2` files instead
- **Hub rejects v1 uploads** — republish existing v1 packages as v2

## [1.0.9] - 2026-03-11

### Added

- **`--file` / `-f` Global Option**: Read prompt content from a file (`.md`, `.txt`, or any text file) for `generate` and `plan` commands. Supports combining with inline prompts — inline text provides context, file content provides the detailed specification. Example: `dojops --file requirements.md "Use Terraform"` or `dojops plan -f spec.txt`

### Fixed

- **Multi-File Output Crash on Non-JSON LLM Responses**: When the LLM returns plain text analysis (e.g., during `analyze-current-dockerfile` planning tasks) instead of JSON file output, the runtime now gracefully falls back instead of throwing `"Multi-file output must be valid JSON"`. Affects analysis-type tasks in plan execution
- **`plan --execute` Fails with "Plan not found" on CRITICAL Risk Plans**: Plans containing tasks with credential/secret/password keywords were classified as `CRITICAL` risk, but the plan validator only accepted `LOW`, `MEDIUM`, `HIGH`. The saved plan was immediately rejected on reload, causing `apply` to report "Plan not found". Added `CRITICAL` to the valid risk levels set
- **Ansible Verification Runs on Inventory Files**: When a plan task generates only inventory/hosts files (no playbooks), the verifier ran `ansible-playbook --syntax-check` on the inventory file, which always fails. Entry-file resolution now excludes inventory, group_vars, host_vars, defaults, vars, meta, and template files. Verification is skipped when no valid playbook entry file exists
- **Module Tasks Skipped as "Documentation Tasks"**: Tasks that mention `README.md`, `.md`, or documentation keywords in their description were incorrectly classified as documentation tasks and skipped entirely — no files written to disk. Affected Helm charts, Ansible roles, and any module task whose description listed a README among output files. Known module tools (all 13 built-in) now bypass the documentation-task filter

## [1.0.8] - 2026-03-09

### Added

- **`config delete` Subcommand**: New `dojops config delete <key>` (alias: `unset`) to remove configuration keys. Previously there was no way to remove a key once set. Also guards `config set` against flag-like values (e.g., `--delete`)
- **Auto-Install Missing Verification Binaries**: When a verification binary (e.g., `ansible-playbook`, `terraform`) is not found during the verify step, DojOps automatically installs the required system tool via the toolchain and retries verification. Uses `OnBinaryMissing` callback pattern threaded from CLI → tool-registry → runtime → binary-verifier
- **Dynamic `{entryFile}` Placeholder in Verification Commands**: Verification commands in `.dops` modules can now use `{entryFile}` to reference the actual generated filename instead of hardcoding it. Resolves to the main entry file from multi-file outputs (prefers `site.yml`/`playbook.yml`, falls back to first top-level `.yml`)
- **`doctor` Always Shows Installed Tools**: The `dojops doctor` command now always displays installed system tools regardless of project relevance. Previously, tools like ansible were hidden if the project context didn't detect matching files

### Changed

- **Sandboxed-First Ansible Install**: `installAnsible()` now uses a sandboxed Python venv (`~/.dojops/toolchain/venvs/ansible/`) as the primary strategy, with pipx as fallback only when python3 is unavailable. Broken venvs (stale shebangs from directory migration) are auto-detected and recreated
- **`BINARY_TO_SYSTEM_TOOL` Mapping**: New lookup table maps verification binary names (e.g., `ansible-playbook`) to their parent system tool (e.g., `ansible`) for auto-install resolution
- **Default Generation Timeout Increased**: Default timeout for `generate` and `apply` commands increased from 60s to 120s. Complex modules with slower providers (DeepSeek, Ollama) frequently exceeded the previous limit
- **All 9 Verification Commands Use `{entryFile}`**: Updated Kubernetes, Dockerfile, Docker Compose, Nginx, Prometheus, GitLab CI, Systemd, Makefile, and Jenkinsfile `.dops` modules to use the `{entryFile}` placeholder instead of hardcoded filenames. All 13 built-in modules now use dynamic file references
- **`verify` Command Uses Dynamic Filenames**: The `dojops verify` CLI command no longer hardcodes filenames (`main.tf`, `manifest.yaml`, `playbook.yml`, `docker-compose.yml`, `prometheus.yml`, `Dockerfile`) — it now uses the actual basename of the file being verified
- **Review Tool Map Narrowed for kubectl**: The DevSecOps review tool map no longer routes all `*.yaml`/`*.yml` files to `kubectl --dry-run`. kubectl validation is now scoped to Kubernetes-specific directories (`k8s/`, `kubernetes/`, `manifests/`, `deploy/`)
- **Test Coverage**: 2275 → 2649 tests (+374 new tests covering auto-install, {entryFile} resolution, BINARY_TO_SYSTEM_TOOL mapping, DevSecOps review pipeline, and execution memory)

### Fixed

- **`rollback --dry-run` Performing Actual Rollback**: The `--dry-run` flag was consumed by `parseGlobalOptions()` before reaching the rollback command, so `hasFlag(args, "--dry-run")` always returned false. Now uses `ctx.globalOpts.dryRun`
- **`apply --dry-run` Not Respecting Flag**: The `--dry-run` global flag was consumed by the global parser but `apply` read it from local args, so `apply --dry-run` always wrote files. Now correctly checks `ctx.globalOpts.dryRun` as fallback
- **Multi-Document YAML Validation Rejection**: The YAML validator in the runtime rejected valid multi-document YAML files (common in Kubernetes manifests using `---` separators). Changed `yaml.load()` to `yaml.loadAll()` to parse all documents
- **`chat export --format=json` Treating Flag as Session ID**: `args[1]` was used unconditionally as the session ID, so `--format=json` was interpreted as a session ID instead of a flag. Now skips flag arguments when extracting the session ID
- **`generate --output json` Double-Encoding**: JSON output wrapped content in an escaped string instead of embedding the JSON object. Content that is valid JSON is now parsed and embedded as a structured object
- **`verify` Showing PASSED for Skipped Checks**: When a verification binary was not found (e.g., hadolint), the command displayed "PASSED" with a warning. Now correctly displays "SKIPPED" to avoid confusion
- **Ansible Verification Fails with Dynamic Filenames**: Verification command `ansible-playbook --syntax-check playbook.yml` was hardcoded, failing when the LLM generated files with different names (e.g., `setup-ec2.yml`). Now uses `{entryFile}` placeholder resolved at runtime
- **Broken Ansible Venv After Toolchain Migration**: Python venv scripts retained shebangs pointing to old `~/.dojops/tools/` path after auto-migration to `~/.dojops/toolchain/`. `symlinkAnsibleCompanions()` now validates shebangs via `isVenvScriptWorking()` and skips broken sources
- **ESLint Errors**: Converted 6 `require()` calls to dynamic `import()`, removed 7 unused variables/imports across api, cli packages

## [1.0.7] - 2026-03-07

### Added

- **Jenkinsfile Module**: New `jenkinsfile.dops` v2 built-in module for generating Jenkins declarative pipeline configurations. Added Jenkinsfile keyword routing in `MODULE_KEYWORDS` and canonical detection paths in the decomposer — total built-in modules: **13**
- **Installed Module Auto-Detection**: Hub-installed and custom `.dops` modules (in `.dojops/tools/` or `.dojops/modules/`) are now automatically detected from natural language prompts. Previously, only the 13 built-in modules were keyword-matched; installed modules silently fell through to the generic agent router
- **SonarCloud Integration**: Added `sonar-project.properties` for static analysis with SonarCloud. Quality Gate badge added to README
- **Centralized `safe-exec` Modules**: New `safe-exec.ts` in `@dojops/runtime`, `@dojops/cli`, and `@dojops/tool-registry` — all OS command execution routed through `execFileSync` with array arguments (no shell injection). Single audit point for SonarCloud S4721 compliance
- **Sandboxed npm Tool Dependencies**: `dojops init` now installs npm tool dependencies (shellcheck, pyright, snyk, dockerfilelint, yaml-lint, hcl2json, opa-wasm) into `~/.dojops/toolchain/` instead of globally via `npm install -g`. No elevated permissions required. Binary resolution checks both `toolchain/bin/` and `toolchain/node_modules/.bin/`
- **Global `--dry-run` Flag**: Preview changes without writing files on `generate`, `plan`, and `apply` commands. Shows generated content and planned actions without side effects
- **`doctor --fix` Auto-Remediation**: The `doctor`/`status` command now accepts `--fix` to auto-repair all fixable issues — creates missing `.dojops/` directory, fixes config file permissions (0o600), ensures toolchain directory exists, and auto-installs all missing npm and system tools without prompting
- **Config `get`/`set`/`validate` Subcommands**: Granular config management — `config get <key>` reads any config value (with token masking), `config set <key> <value>` writes with validation, `config validate` checks file integrity, permissions, and value ranges
- **`chat export` Command**: Export chat sessions as Markdown or JSON — `chat export [sessionId] [--format=json|markdown] [--output=file.md]`. Supports single session or bulk export
- **Toolchain Install Retry with Context7**: When npm or system tool installation fails during `dojops init`, the CLI now retries automatically and queries Context7 for correct install instructions. If both attempts fail, displays manual installation guidance with Context7 hints when available
- **Context7 Enabled by Default**: Context7 documentation augmentation is now enabled by default across `generate`, `chat`, `serve`, and toolchain install. Set `DOJOPS_CONTEXT_ENABLED=false` to opt out
- **Lifecycle Hook System**: New `.dojops/hooks.json` configuration file for shell commands that execute at lifecycle events — `pre-generate`, `post-generate`, `pre-plan`, `post-plan`, `pre-execute`, `post-execute`, `pre-scan`, `post-scan`, `on-error`. Hook context passed via `DOJOPS_HOOK_*` environment variables. Pre-hooks abort on failure; post-hooks continue by default
- **Model Failover Chains**: New `--fallback-provider` flag and `DOJOPS_FALLBACK_PROVIDER` env var for comma-separated LLM provider fallback chains (e.g., `--fallback-provider openai,deepseek,ollama`). Primary provider is tried first; failures automatically cascade to the next provider in the chain
- **`modules dev` Command**: New `dojops modules dev <file.dops> [--watch]` for module development — validates `.dops` files and optionally watches for changes with automatic re-validation. Shows format details (files, sections, risk, rules) on each validation pass
- **Cron/Scheduled Jobs**: New `dojops cron add|list|remove` for managing scheduled DojOps commands stored in `.dojops/cron.json`. Jobs include cron schedule, command, and generated system crontab entries for easy integration
- **Smart Progress Reporter**: Multi-step operations (apply) now show TTY-aware progress — inline progress bar with percentage on terminals, plain log lines on CI/non-TTY. Detects `$CI`, `$NO_COLOR`, and TTY status automatically
- **Init `--skip-*` Flags**: New `--skip-scan`, `--skip-tools`, `--skip-review` flags on `dojops init` for selective initialization — skip repository scanning, tool dependency installation, or interactive review prompt

### Changed

- **Test Coverage**: 2140 → 2275 tests (+135 new tests covering SAST fixes, module detection, cognitive complexity refactors, and edge cases)

### Fixed

- **Node 24 Compatibility**: Fixed `crypto.randomInt(2 ** 48)` off-by-one error in toolchain download temp file naming — Node 24 enforces `max <= 2^48 - 1`, which caused all system tool installations to fail with `ERR_OUT_OF_RANGE`
- **Stale System Tool Versions**: Updated all 10 system tool versions to latest releases — terraform 1.14.6, kubectl 1.35.2, gh 2.87.3, hadolint 2.14.0, trivy 0.69.3, helm 4.1.1, shellcheck 0.11.0, actionlint 1.7.11, promtool 3.10.0, circleci 0.1.34770 (was 404-ing on download)

- **SAST / SonarCloud — Security Hotspots**
  - Replaced all `child_process.execSync()` shell calls with `execFileSync()` array-argument form across runtime, CLI, scanner, and tool-registry packages — eliminates OS command injection vectors (S4721)
  - Hardened OS command execution in scanner binaries (trivy, gitleaks, checkov, hadolint, shellcheck, semgrep) with strict argument arrays
  - Replaced regex-based ReDoS guard in input sanitizer with iterative character scanning — prevents catastrophic backtracking (S5852)

- **SAST / SonarCloud — Code Smells**
  - Reduced cognitive complexity across 8 high-complexity functions: `history.ts` (list/show), `tools.ts` (publish/init wizard), `scanner/runner.ts`, `scan.ts` command, and `toolchain.ts` — extracted helper functions, simplified control flow
  - Reduced code duplication from >5% to <3% across all packages by extracting shared patterns into utility functions
  - Removed unused imports, variables, and dead code paths flagged by static analysis across all 11 packages
  - Fixed inconsistent return types, missing `readonly` modifiers, and type narrowing issues

- **SAST / SonarCloud — Bugs**
  - Fixed null/undefined dereferences in agent loader, custom tool parser, and JSON Schema-to-Zod converter
  - Fixed edge cases in session serializer, context injector, and memory module where missing properties caused runtime errors
  - Fixed policy enforcement bypass when tool name contained path separators

- **Ollama `stripCodeFences` Preamble Handling**: `stripCodeFences()` now correctly strips preamble text before code fences (e.g., "Here is the config:\n```yaml\n...") — previously only stripped the fence markers, leaving conversational preamble in generated output
- **Ollama Schema Double-Encoding**: Fixed double JSON encoding of schema in Ollama provider's `format` parameter — schema was being stringified twice, causing Ollama to receive an escaped string instead of a JSON object
- **Hub v2 Module Install**: `dojops modules install` now uses `parseDopsStringAny()` (version-detecting parser) instead of the v1-only `parseDopsString()` — v2 modules from the Hub are now correctly parsed and loaded
- **Chat `/exit` Process Hang**: Chat session now calls `process.exit()` after `/exit` command to prevent the process from hanging due to Ollama HTTP keepalive connections holding the event loop open
- **Tool → Module Terminology**: All user-facing CLI output strings updated from "tool" to "module" for consistency with the `.dops` module naming convention (internal TypeScript types unchanged)

## [1.0.6] - 2026-03-04

### Added

- **`dojops upgrade` Command**: New CLI command to check for and install CLI updates. Fetches the latest version from the npm registry, compares with the current version, and runs `npm install -g @dojops/cli@<version>` with interactive confirmation. Supports `--check` flag (check-only, exit 1 if update available), `--yes` for auto-approval, `--non-interactive` mode, and `--output json` for structured output
- **`modules init` v2 Scaffold with LLM**: `dojops modules init <name>` now generates `.dops v2` files by default (was v1). When an LLM provider is configured, offers AI-powered generation of best practices, output guidance, prompt templates, keywords, risk classification, detection paths, and Context7 library references. Falls back to sensible defaults when no provider is available. Use `--legacy` flag to generate v1 `tool.yaml` format
- **`agents info` Partial Name Matching**: `dojops agents info` now supports prefix matching (`terraform` → `terraform-specialist`), segment matching (`security` → `security-auditor`, `cloud` → `cloud-architect`), and "Did you mean?" suggestions when no match is found
- **`inspect` Default Summary**: `dojops inspect` with no target now shows both config and session state instead of erroring

### Changed

- **Simplified `.dops` v2 Format**: v2 `.dops` files now only require `## Prompt` and `## Keywords` markdown sections. Removed `## Examples` (replaced by Context7 runtime docs), `## Constraints` (merged into `context.bestPractices`), and `## Update Prompt` (generic update fallback is always used). This makes it much easier for users to contribute new `.dops` modules
- **All 13 Built-in Modules Updated**: Constraints merged into `context.bestPractices` arrays; `## Examples`, `## Constraints`, and `## Update Prompt` sections removed from all built-in `.dops` modules
- **36 Community Modules Updated**: All modules in `dojops-dops-tools` updated to the simplified v2 format
- **Tool → Module Rename**: User-facing CLI commands renamed from `dojops tools` to `dojops modules` (with `tools` as backward-compatible alias). `--tool` flag renamed to `--module` (with `--tool` alias). Custom module discovery now searches `.dojops/modules/` as the primary path with `.dojops/tools/` as fallback. Internal TypeScript types (`BaseTool`, `ToolRegistry`, etc.) are unchanged. All documentation, website, and community repos updated
- **`analyze diff` Help Text**: Reordered usage to recommend `--file` first for multiline diffs, added note about shell escaping limitations with inline arguments

### Fixed

- **`modules validate` Path Lookup**: `dojops modules validate <name>` now searches `.dojops/modules/` (where `modules init` creates files) in addition to `.dojops/tools/`. Previously, modules created by `init` could not be found by `validate`
- **Technology Name Capitalization**: `modules init` now properly title-cases hyphenated tool names (e.g., `redis-config` → "Redis Config" instead of "Redis-config")
- **Dashboard Sign-In Button**: Centered the "Sign In" button text on the authentication overlay (was left-aligned due to flexbox default)
- **Verification Timeout on Node 20**: Reduced custom tool verification command timeout from 30s to 10s, fixing a test timeout on Node 20 CI runners when the verification binary is not installed

## [1.0.5] - 2026-03-03

### Added

- **`.dops` v2 Format**: New `.dops v2` module format that replaces `input.fields` and `output` blocks with a `context` block containing `technology`, `fileFormat`, `outputGuidance`, `bestPractices`, and `context7Libraries`. The LLM generates raw file content directly (no JSON→serialize step), producing cleaner output with less schema overhead
- **`DopsRuntimeV2`**: New runtime class (`packages/runtime/src/runtime.ts`) for processing v2 modules — compiles prompts with `compilePromptV2()`, strips code fences from raw LLM output via `stripCodeFences()`, and integrates with Context7 via the `DocProvider` interface
- **All 13 Built-in Tools Converted to v2**: All built-in `.dops` modules in `packages/runtime/modules/` now use v2 format with `context` blocks, best practices, and Context7 library references
- **Version-Detecting Parsers**: `parseDopsStringAny()` and `parseDopsFileAny()` (`packages/runtime/src/parser.ts`) automatically detect the `dops` version field and route to `DopsRuntime` (v1) or `DopsRuntimeV2` (v2)
- **v2 Prompt Variables**: New template variables for v2 prompts — `{outputGuidance}` (from `context.outputGuidance`), `{bestPractices}` (numbered list from `context.bestPractices`), `{context7Docs}` (documentation fetched at runtime via Context7), `{projectContext}` (project scanner context)
- **`DocProvider` Interface**: Duck-typed interface (`{ augmentPrompt() }`) for Context7 documentation augmentation in v2 tools, injected into `DopsRuntimeV2` at construction time
- **Hub v1/v2 Backward Compatibility**: Hub database extended with `dopsVersion` and `contextBlock` columns on the `Version` model, supporting both v1 and v2 `.dops` format uploads and downloads
- **93 New v2 Tests**: Comprehensive test coverage for v2 parsing, prompt compilation, raw content generation, code fence stripping, Context7 integration, and version detection (total: 1931 → 2140 tests)
- **Context7 Documentation Augmentation (`@dojops/context`)**: New package that fetches up-to-date documentation from [Context7](https://context7.com) and injects it into LLM system prompts during generation — improving output accuracy even when the LLM's training data is stale. Covers all 13 built-in tool domains and specialist agent domains via static library mapping. Opt-in via `DOJOPS_CONTEXT_ENABLED=true`.
- **Context7 REST Client**: Native `fetch()` client for Context7 API (`/v2/libs/search` + `/v2/context`) with configurable timeout (10s default), optional API key auth (`DOJOPS_CONTEXT7_API_KEY`), and in-memory TTL cache (5 min default, configurable via `DOJOPS_CONTEXT_CACHE_TTL`)
- **Documentation-Augmented Agent Routing**: `SpecialistAgent.run()` and `runWithHistory()` now accept an optional duck-typed `docAugmenter` and prepend a `## Reference Documentation` section to the system prompt with current syntax references
- **Documentation-Augmented Tool Generation**: `DopsRuntime.generate()` augments the compiled system prompt with Context7 docs after `compilePrompt()`, giving all 13 built-in tools and user `.dops` files access to current documentation
- **Augmenter Threading**: `createRouter()` and `createToolRegistry()` factories accept an optional `docAugmenter` param; CLI creates the augmenter in `generate`, `chat`, and `serve` commands when enabled
- **Schema Injection for LLM Providers**: All 6 providers (OpenAI, Anthropic, DeepSeek, Gemini, GitHub Copilot, Ollama) now embed the full JSON Schema in the system prompt via `augmentSystemPrompt()`, dramatically improving structured output accuracy — especially for providers without native schema enforcement
- **Scanner Install Hints**: `dojops scan` now displays per-scanner install instructions (brew/apt/pip/URL) when scanners are skipped due to missing binaries
- **npm-audit Without Lockfile**: `dojops scan --deps` now generates a temporary lockfile when only `package.json` exists, enabling dependency auditing without a committed lockfile
- **`--provider` Flag for `serve`**: `dojops serve --provider=<name>` overrides the LLM provider for the API server session
- **Plan Retry (`--retry`)**: `dojops apply --resume --retry` now retries failed tasks (previously only skipped completed tasks)
- **`check --fix` Auto-Remediation**: `dojops check --fix` sends HIGH/CRITICAL findings to the LLM for auto-remediation and generates file patches with approval
- **Scanner Timeout Handling**: Scanners now respect a per-scanner timeout (default 60s, configurable via `DOJOPS_SCAN_TIMEOUT_MS`); timed-out scanners are reported in `scannersSkipped`
- **`config profile use default`**: Reset to base configuration after switching to a named profile
- **Available Plans in `clean`**: `dojops clean` without a plan ID now lists available plans with status and date to help users pick the right one

### Changed

- **Tool Generation Model**: Built-in tools now generate raw file content directly via LLM instead of structured JSON objects that required serialization. This produces more natural output and eliminates the JSON→serialize step
- **`docker-compose` Risk Level**: Changed from `MEDIUM` to `LOW` — Compose changes are local development configurations
- **Tool Registry v2 Routing**: `ToolRegistry` now uses `parseDopsFileAny()` for version detection and routes v2 modules to `DopsRuntimeV2` via `isV2Module()` check
- **`serve` Provider Resolution**: `dojops serve` now uses `resolveProvider()` to correctly respect `DOJOPS_PROVIDER` env var (previously ignored it)
- **`--no-auth` Safety Warning**: `dojops serve --no-auth` now displays a prominent warning: "API authentication disabled. Do not expose to untrusted networks."
- **Apply Exit Codes**: `dojops apply` now exits with code 1 on FAILURE or PARTIAL status instead of 0, enabling CI integration
- **Apply Plan Auto-Selection**: `dojops apply` now shows which plan was auto-selected ("Using session plan: ..." or "Using latest plan: ...")
- **`config show` Active Profile**: `dojops config show` now displays the active profile name in the title when a non-default profile is active
- **`config show` Effective Provider**: `dojops config show` displays effective provider with env var override details when `DOJOPS_PROVIDER` differs from config
- **Inspect Error Messages**: `dojops inspect` now shows distinct error messages for no subcommand vs unknown subcommand, with usage examples
- **Session ID Error**: API chat session lookup now returns generic "Session not found" (404) instead of leaking implementation details about ID format
- **Chat Send Error Handling**: API `POST /api/chat` now returns 500 with error message on `session.send()` failure instead of crashing the route

### Fixed

- **`chat --agent` Validation**: `dojops chat --agent=<invalid>` now correctly rejects unknown agent names and lists available agents — previously silently fell through to default routing because `--agent` was consumed by the global parser but `chat.ts` tried to re-extract it from args
- **`tools init` Flag Parsing**: `dojops tools init --yes` no longer treats `--yes` as the tool name; flags are now filtered from positional arguments before extracting the tool name
- **`toolchain install` Exit Code**: `dojops toolchain install` now exits with code 1 on failure (e.g., missing `unzip`) instead of silently exiting 0
- **Schema Transform Crash**: `augmentSystemPrompt()` no longer crashes when a Zod schema contains `.transform()` or `.pipe()` — gracefully falls back to generic JSON instruction
- **API 404 JSON Response**: Unmatched `/api/*` routes now return `{"error":"Not found"}` (JSON) instead of Express default HTML error page
- **`serve` Provider Bug**: `dojops serve` now correctly uses `resolveProvider()` instead of ignoring the `DOJOPS_PROVIDER` environment variable
- **`--no-auth` Flag Override**: `dojops serve --no-auth` now correctly disables auth even when `server.json` or env var sets an API key
- **API Version Header**: `X-API-Version: 1` header is now correctly set on `/api/v1/health` endpoint (middleware registration order fix)
- **`doctor`/`status` Provider Display**: Now uses `resolveProvider()` to show effective provider including env var overrides
- **`auth status` Provider Display**: Now uses `resolveProvider()` to show effective provider including env var overrides
- **`init` Empty Directory**: Skips LLM enrichment when no project files are detected, avoiding wasted API calls
- **Scan No-Scanners Warning**: Displays a prominent warning when all scanners are skipped instead of silently showing empty results
- **Apply Task Status Wording**: PlannerExecutor now reports tasks as "generated" instead of "completed" to avoid confusion with the full lifecycle status

## [1.0.4] - 2026-03-03

### Added

- **Primary Keywords**: Specialist agents now support `primaryKeywords` — high-signal keywords that receive a confidence boost (+0.1 per match) during routing, improving agent selection accuracy
- **Project-Context Biased Routing**: Agent routing now considers project domains detected by `dojops init`, boosting confidence (+0.15) for agents whose domain matches the project context
- **Agent Retry & Timeout**: `SpecialistAgent.run()` and `runWithHistory()` now support configurable timeout (default 120s) and automatic single retry on transient errors (network/5xx/429)
- **Message Size Validation**: `runWithHistory()` now filters out oversized messages (>128KB) to prevent LLM context overflow

### Changed

- **TUI Output Limits**: Increased `formatOutput` line limit from 20 to 50 and apply preview limit from 2000 to 5000 characters for better visibility of large outputs
- **TUI Word Wrapping**: Added `wrapForNote()` utility for ANSI-safe word-wrapping in `p.note()` boxes, applied across check, debug, analyze, explain, plan, apply, and scan commands — fixes broken box-drawing characters when content exceeds terminal width

### Fixed

- **Project-Aware Tool Filtering**: `init`, `status`/`doctor`, and `check` commands now filter optional tool suggestions by detected project domains — no more suggesting Makefile for Java projects or Terraform for Node.js apps
- **Check Command Relevance**: The `check` command now includes project-type constraints in the LLM system prompt, producing domain-relevant maturity findings only
- **Message Sanitization**: `runWithHistory()` now sanitizes all message roles (not just user messages) for consistent input handling

### Removed

- **Unused Icon Asset**: Removed `packages/cli/assets/dojops-icon.png` and its copy logic from `initProject()` — the CLI never displayed it; the dashboard uses its own icon from `api/public/icons/`

## [1.0.3] - 2026-03-02

### Fixed

- **Hub URL Default**: Changed `DOJOPS_HUB_URL` default from `http://localhost:3000` to `https://hub.dojops.ai` so `tools publish`, `tools install`, and `tools search` connect to the production hub out of the box

## [1.0.2] - 2026-03-02

First official public release. Versions 1.0.0 and 1.0.1 were internal testing releases.

### Added

- **LLM Providers**: 6 providers (OpenAI, Anthropic, Ollama, DeepSeek, Gemini, GitHub Copilot) with structured JSON output via Zod schemas, temperature passthrough, and dynamic model selection via `listModels()`. GitHub Copilot uses OAuth Device Flow with JWT auto-refresh.
- **DevOps Tools**: 13 built-in tools (GitHub Actions, Terraform, Kubernetes, Helm, Ansible, Docker Compose, Dockerfile, Nginx, Makefile, GitLab CI, Prometheus, Systemd, Jenkinsfile) with generate, detect, verify, and execute lifecycle.
- **Plugin System**: Declarative `plugin.yaml` manifests with JSON Schema input validation, plugin discovery from global (`~/.dojops/plugins/`) and project (`.dojops/plugins/`) directories, policy enforcement via `.dojops/policy.yaml`, verification command whitelist, and path traversal prevention.
- **Specialist Agents**: 16 built-in specialist agents (ops-cortex, terraform, kubernetes, cicd, security-auditor, observability, docker, cloud-architect, network, database, gitops, compliance-auditor, ci-debugger, appsec, shell, python) with keyword-based routing and confidence scoring. Custom agent discovery from `.dojops/agents/` README.md files.
- **Security Scanning**: 10 scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom, trivy-license, semgrep) supporting `--security`, `--deps`, `--iac`, and `--sbom` scan modes with structured reports saved to `.dojops/scans/`. Scan comparison via `--compare` flag shows new/resolved findings.
- **REST API & Web Dashboard**: Express-based API with 20 endpoints for generation, planning, debugging, scanning, chat, agents, history, and metrics. Vanilla web dashboard with dark theme and 5 tabs (Overview, Security, Audit, Agents, History).
- **CLI**: Rich terminal UI via `@clack/prompts` with commands for `init`, `plan`, `validate`, `apply`, `destroy`, `rollback`, `explain`, `debug ci`, `analyze diff`, `chat`, `scan`, `serve`, `agents`, `history`, `tools`, and more.
- **Sandboxed Execution**: `SafeExecutor` with `ExecutionPolicy` (write/path/env/timeout/size restrictions), `SandboxedFs` for restricted file operations, and `ApprovalHandler` interface (auto-approve, auto-deny, callback).
- **Audit Trails**: Hash-chained JSONL audit logs with verification results, plugin metadata, execution context, and `systemPromptHash` tracking.
- **Plan Lifecycle**: `Plan -> Validate -> Apply` workflow with `TaskGraph` decomposition, topological execution, `$ref:<taskId>` input wiring, `--resume` for interrupted plans, `--replay` deterministic mode, and plugin version pinning.
- **CI Debugger**: Analyzes CI logs and produces structured `CIDiagnosis` (error type, root cause, fixes, confidence).
- **Infra Diff Analyzer**: Analyzes infrastructure diffs and produces `InfraDiffAnalysis` (risk level, cost impact, security impact, recommendations).
- **Chat Sessions**: Interactive multi-turn conversation support with session persistence and agent routing.
- **Metrics Dashboard**: `MetricsAggregator` for `.dojops/` data aggregation (plans, executions, scans, audit) with Overview, Security, and Audit dashboard tabs.
- **Trust Hardening**: Hard file write allowlist, plan snapshot freezing, risk classification, drift awareness warnings, SBOM persistence versioning, change impact summary, CI provider schema validation.
- **Atomic File Writes**: Write to `.tmp` then rename for crash safety across all 13 tools and `SandboxedFs`.
- **DOPS Spec Hardening**: 5 new `.dops` frontmatter sections for v1 contract freeze:
  - `scope` — Write boundary enforcement with `{var}` path expansion; out-of-scope writes rejected at runtime
  - `risk` — Tool self-classification (`LOW`/`MEDIUM`/`HIGH`) with rationale; exposed in `ToolMetadata.riskLevel`
  - `execution` — Mutation semantics: `mode` (generate/update), `deterministic`, `idempotent` flags
  - `update` — Structured update behavior: `strategy` (replace/preserve_structure), `inputSource`, `injectAs`
  - `meta.icon` — Optional HTTPS URL (max 2048 chars) for marketplace tool icon display
- **Scope Enforcement in File Writer**: `writeFiles()` validates resolved paths against `scope.write` patterns after variable expansion; `matchesScopePattern()` helper exported
- **Risk & Execution Getters**: `DopsRuntime.risk`, `.executionMode`, `.isDeterministic`, `.isIdempotent` with safe defaults
- **Parser Validation**: Path traversal prevention on `scope.write` paths; network permission constraint for v1 tools with risk declared
- **Prompt Compiler Update Strategy**: `preserve_structure` injects additional LLM instructions; `injectAs` controls variable name for existing content
- **13 Module Updates**: All built-in `.dops` modules updated with `scope`, `risk`, `execution`, and `update` sections
- **Test Coverage**: New unit tests across packages to meet 75% coverage threshold
- **Tool Command `new` Option**: `dojops tools new` scaffolds a new custom tool from a template
- **Tool Subcommands**: Additional `dojops tools` subcommands for managing tool lifecycle
- **Release Workflow**: Changelog-driven GitHub Release notes (replaces auto-generated notes)
- **Dev Tooling**: 1931+ Vitest tests, ESLint, Prettier, Husky + lint-staged, Turbo monorepo build, conventional commit hooks, Dependabot, release workflow.

### Changed

- **Tool Publish Auth Flow**: Updated authentication flow for publishing tools to DojOps Hub
- **CLI Banner**: Updated CLI banner and mascot display

### Fixed

- **Doc Site URL**: Corrected documentation site URL references
- **Brew Installer**: Fixed Homebrew tap installer issues
