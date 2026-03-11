# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-03-11

### Breaking Changes

- **Removed `.dops v1` format support** — all modules must use `dops: v2` frontmatter
- **Removed `tool.yaml` custom tool manifests** — create custom modules as `.dops v2` files instead
- **Renamed `@dojops/tool-registry` to `@dojops/module-registry`**
- **Renamed types** — `BaseTool` → `BaseModule`, `ToolRegistry` → `ModuleRegistry`, `DevOpsTool` → `DevOpsModule`, `ToolOutput` → `ModuleOutput`
- **Hub rejects v1 uploads** — republish existing v1 packages as v2
- **`dojops tools` deprecated** — use `dojops modules` instead (alias still works with warning)

### Removed

- `DopsRuntime` v1 class, v1 prompt compiler (`compilePrompt`)
- `CustomTool` class and `tool.yaml` / `plugin.yaml` manifest discovery
- `docs/TOOL_SPEC_v1.md` specification document
- All deprecated `Plugin*` type aliases (`PluginManifest`, `PluginSource`, `PluginEntry`, etc.)
- `parseDopsFile()` and `parseDopsString()` v1-only parsers
- v1 schema types: `InputFieldDef`, `FileSpec` (v1), `DopsFrontmatterSchema` (v1)

### Changed

- `DopsModuleV2` renamed to `DopsModule` (only module type)
- `DopsFrontmatterV2` renamed to `DopsFrontmatter`
- `parseDopsFileAny()` renamed to `parseDopsFile()` (v2-only)
- `parseDopsStringAny()` renamed to `parseDopsString()` (v2-only)
- `createToolRegistry()` renamed to `createModuleRegistry()`

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
