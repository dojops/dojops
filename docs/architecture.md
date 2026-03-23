# Architecture

DojOps is designed as a modular, layered DevOps agent system - not a simple chatbot that generates bash commands. It is a structured, safe, extensible orchestration framework with 31 built-in DevOps skills, a custom skill system for extending with additional skills, 32 specialist agents, 7 LLM providers with tiered model routing, sandboxed execution, approval workflows, and hash-chained audit trails.

---

## High-Level Data Flow

```
User
 |
 v
CLI (@clack/prompts TUI) / REST API (Express)
 |
 v
Agent Router (32 specialist agents, keyword confidence scoring)
 |
 v
Planner Engine (LLM -> TaskGraph -> topological execution)
 |
 v
Skill Registry (31 built-in skills + custom skills, unified discovery)
 |
 v
Skill SDK Layer (BaseSkill<T>, Zod validation)
 |
 v
Execution Engine (Sandboxed, policy-enforced, approval-gated, audit-logged)
```

---

## Package Architecture

DojOps is a pnpm monorepo with Turbo build orchestration. TypeScript (ES2022, CommonJS). All packages use the `@dojops/*` scope.

### 12 Packages

```
@dojops/cli            CLI entry point + rich TUI (@clack/prompts)
@dojops/api            REST API (Express) + web dashboard + factory functions
@dojops/skill-registry Skill registry + custom skill system (discovers built-in + custom skills)
@dojops/planner        TaskGraph decomposition + topological executor
@dojops/executor       SafeExecutor: sandbox + policy engine + approval + audit log
@dojops/mcp            MCP (Model Context Protocol) client — server lifecycle, tool discovery, dispatcher
@dojops/runtime        31 built-in DevOps skills as .dops v2 files (DopsRuntime)
@dojops/scanner        10 security scanners + remediation engine
@dojops/session        Chat session management + autonomous agent loop (AgentLoop) + memory + context injection
@dojops/context        Context7 documentation augmentation for v2 skills
@dojops/core           LLM abstraction + 7 providers + 32 specialist agents + tiered model routing + CI debugger + infra diff + DevOps checker
@dojops/sdk            BaseSkill<T> abstract class with Zod validation + optional verify() + file-reader utilities
```

### Dependency Flow

```
@dojops/cli
  +-- @dojops/api
  |     +-- @dojops/skill-registry
  |     |     +-- @dojops/runtime
  |     |     |     +-- @dojops/core
  |     |     |     +-- @dojops/sdk
  |     |     +-- @dojops/core
  |     |     +-- @dojops/sdk (zod)
  |     +-- @dojops/planner
  |     |     +-- @dojops/core
  |     |           +-- @dojops/sdk (zod)
  |     +-- @dojops/executor
  |     |     +-- @dojops/core
  |     |     +-- @dojops/sdk
  |     +-- @dojops/scanner
  |     +-- @dojops/context
  |     |     +-- @dojops/core
  |     +-- @dojops/session
  |           +-- @dojops/core
```

**Simplified linear flow:**

```
cli -> api -> skill-registry -> runtime -> core -> sdk
          -> planner -> executor
          -> scanner
          -> context -> core
          -> session -> executor -> core
cli -> mcp -> core (optional, dynamic import)
```

---

## Layer Descriptions

### 1. LLM Layer (`@dojops/core`)

Abstraction over seven LLM providers with structured JSON output and tiered model routing:

| Provider       | JSON Mode Mechanism                                     | SDK                 |
| -------------- | ------------------------------------------------------- | ------------------- |
| OpenAI         | `response_format: { type: "json_object" }`              | `openai`            |
| Anthropic      | JSON prefill technique                                  | `@anthropic-ai/sdk` |
| Ollama         | `format: "json"`                                        | `ollama`            |
| DeepSeek       | OpenAI-compatible API with custom `baseURL`             | `openai`            |
| Mistral        | OpenAI-compatible API with custom `baseURL`             | `openai`            |
| Gemini         | `responseMimeType: "application/json"`                  | `@google/genai`     |
| GitHub Copilot | OpenAI-compatible API with Copilot `baseURL` + JWT auth | `openai`            |

**Tiered model routing** (`ModelRouter`) automatically selects the right model size based on task complexity:

| Provider       | Fast tier        | Standard tier     | Premium tier      |
| -------------- | ---------------- | ----------------- | ----------------- |
| OpenAI         | gpt-4o-mini      | gpt-4o            | o1                |
| Anthropic      | claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-6   |
| Ollama (local) | llama3.2:3b      | llama3.1:8b       | llama3.1:70b      |
| DeepSeek       | deepseek-chat    | deepseek-chat     | deepseek-reasoner |
| Mistral        | mistral-small    | mistral-medium    | mistral-large     |
| Gemini         | gemini-2.0-flash | gemini-2.5-pro    | gemini-2.5-pro    |
| GitHub Copilot | gpt-4o-mini      | gpt-4o            | o1                |

Simple prompts (makefiles, basic configs) use the fast tier. Complex prompts (multi-service architectures, security hardening) use the premium tier. Agent routing always uses the fast tier to keep costs low.

Key interface:

```typescript
interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  generateWithTools?(request: LLMToolRequest): Promise<LLMToolResponse>;
  listModels?(): Promise<string[]>;
}
```

The optional `generateWithTools()` method enables native tool-calling for the autonomous agent loop. OpenAI, Anthropic, and Gemini use provider-native tool-calling APIs; Ollama uses a prompt-based fallback that injects tool descriptions into the system prompt and parses structured JSON output.

All responses pass through `parseAndValidate()` — strips markdown fences, `JSON.parse`, Zod `safeParse` — ensuring every LLM output conforms to the expected schema. All 7 providers support `temperature` passthrough for deterministic reproducibility (conditionally included in API calls only when explicitly set). A `DeterministicProvider` wrapper forces `temperature: 0` on every call for replay mode (`apply --replay`). A `FallbackProvider` wraps multiple providers and automatically falls back to the next on failure (configured via `--fallback-provider` flag or `DOJOPS_FALLBACK_PROVIDER` env var). The `GitHubCopilotProvider` creates a new OpenAI client per `generate()` call to use the freshest JWT (tokens expire every ~30 min).

### 2. Multi-Agent System (`@dojops/core`)

32 built-in specialist agents with keyword-based routing and confidence scoring, plus support for custom agents. The `AgentRouter` scores prompts against each agent's keyword list and routes to the highest-confidence match. If no agent exceeds the threshold, it falls back to the general-purpose `DevOpsAgent`.

Custom agents are defined as structured `README.md` files in `.dojops/agents/<name>/` (project) or `~/.dojops/agents/<name>/` (global). They can be created via LLM (`dojops agents create "description"`) or manually (`dojops agents create --manual`). Custom agents participate in the same keyword-based routing as built-in agents and can override built-in agents by name. Discovery is handled by `@dojops/skill-registry`.

Additionally, three specialized analyzers (not routed via `AgentRouter`) provide structured analysis:

- **`CIDebugger`** - CI log diagnosis producing `CIDiagnosis` (error type, root cause, fixes)
- **`InfraDiffAnalyzer`** - Infrastructure diff analysis producing `InfraDiffAnalysis` (risk, cost, security) with heuristic risk scoring via `DiffRiskClassifier`
- **`DevOpsChecker`** - DevOps config quality analysis producing `CheckReport` (score 0-100, findings, missing files)

**Diff risk classification** (`DiffRiskClassifier` in `@dojops/api`) scores changes heuristically based on file paths and content patterns. Critical paths (Dockerfile, Terraform state, secrets, IAM) receive higher risk scores. The classifier suggests reviewers and produces a risk summary for each change set.

See [Specialist Agents](agents.md) for the full agent list.

### 3. Task Planner (`@dojops/planner`)

LLM-powered goal decomposition into structured, dependency-aware task graphs with **agent-aware delegation**. The decomposer assigns specialist agents to tasks based on domain relevance, and the executor injects each agent's system prompt as domain context during skill generation. Uses Kahn's algorithm for topological execution ordering, `$ref:<taskId>` for inter-task data wiring, `completedTaskIds` for resume after partial failures, and a **semaphore-based concurrency pool** (`--parallel <n>`) that starts new tasks the instant any slot frees up.

See [Task Planner](planner.md) for details.

### 4. Skill SDK (`@dojops/sdk`)

Abstract `BaseSkill<T>` class with Zod input schema validation, abstract `generate()` for LLM generation, optional `execute()` for file writes, and optional `verify()` for external tool validation. Also provides `readExistingConfig()`, `backupFile()`, `atomicWriteFileSync()` (temp + rename for crash-safe writes), and `restoreBackup()` utilities.

See [DevOps Skills](skills.md) for the skill pattern.

### 4b. DOPS Runtime (`@dojops/runtime`)

The DOPS runtime processes `.dops v2` skill files — a declarative format combining YAML frontmatter with markdown prompt sections for raw content generation with Context7 integration.

**Frontmatter sections** (all optional except `meta`, `files`):

| Section        | Purpose                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `meta`         | Name, version, description, author, license, tags, repository                         |
| `context`      | Technology context, output guidance, best practices, Context7 library references      |
| `files`        | Output file specs with path templates, format, serialization options                  |
| `scope`        | Write boundary — explicit list of allowed write paths (enforced at file-write time)   |
| `risk`         | Self-classification: `LOW` / `MEDIUM` / `HIGH` with rationale string                  |
| `execution`    | Mutation semantics: mode (`generate`/`update`), `deterministic`, `idempotent` flags   |
| `update`       | Update behavior: strategy (`replace`/`preserve_structure`), `inputSource`, `injectAs` |
| `detection`    | Existing file detection paths for auto-update mode                                    |
| `verification` | Structural rules + optional binary verification command                               |
| `permissions`  | Filesystem, child_process, and network permission declarations                        |

**Markdown sections**: `## Prompt` (required), `## Update Prompt` (optional), `## Examples`, `## Constraints`, `## Keywords` (required).

**Key runtime features**:

- `DopsRuntime` — Runtime class for `.dops v2` skills
- `parseDopsFile()` / `parseDopsString()` — Parsers for `.dops v2` files
- `compilePrompt()` — Compiles prompts with `{outputGuidance}`, `{bestPractices}`, `{context7Docs}`, `{projectContext}` variables
- `stripCodeFences()` — Strips markdown code fences from raw LLM output before writing
- `DocProvider` interface — Enables Context7 documentation augmentation for v2 tools
- `DopsRuntime.risk` — Returns declared risk or defaults to `{ level: "LOW", rationale: "No risk classification declared" }`
- `DopsRuntime.metadata` — Includes `riskLevel`, `systemPromptHash`, `toolHash` for audit integration
- **Scope enforcement** — `writeFiles()` validates resolved paths against `scope.write` patterns after `{var}` expansion; out-of-scope writes throw
- **Update strategy** — `preserve_structure` injects additional prompt instructions to maintain existing config organization

### 5. DevOps Skills (`@dojops/runtime`)

31 built-in skills covering CI/CD, IaC, containers, monitoring, security, service mesh, cloud, and system services. All 31 are `.dops v2` skills in `packages/runtime/skills/`, processed by `DopsRuntimeV2` — generating raw file content directly via LLM with Context7 documentation augmentation. All skills support updating existing configs via auto-detection, `existingContent` input, and `.bak` backup before overwrite. All file writes use `atomicWriteFileSync()` for crash safety. Every `execute()` returns `filesWritten`/`filesModified` for rollback tracking.

See [DevOps Skills](skills.md) for the full skill list.

### 5b. Skill Registry (`@dojops/skill-registry`)

Unified registry layer between consumers (Planner, Executor, CLI, API) and skill implementations. Combines all 31 built-in skills with custom skills discovered from disk:

- **`.dops` skill discovery** — Discovers `.dops v2` skills from `~/.dojops/skills/` (global) and `.dojops/skills/` (project)
- **Skill validation** — Zod schema validates `.dops` frontmatter
- **Skill policy** — `.dojops/policy.yaml` supports `allowedSkills` and `blockedSkills` lists
- **Audit enrichment** — Custom skill executions include `toolType`, `toolSource`, `toolVersion`, `toolHash`, and `systemPromptHash` in audit entries
- **Skill isolation** — Verification commands restricted to a whitelist of 33 allowed binaries, `child_process` permission must be `"required"` for execution, path traversal (`..`) blocked in file paths and detector paths
- **OnBinaryMissing callback** — When a verification binary is not found, the callback triggers automatic installation via `dojops toolchain install` and retries verification
- **Unified interface** — `SkillRegistry.getAll()` returns `DevOpsSkill[]`, so Planner, Executor, and API remain unchanged

### 6. Execution Engine (`@dojops/executor`)

Orchestrates generate -> verify -> approve -> execute with policy enforcement, sandboxed file operations, and audit logging.

See [Execution Engine](execution-engine.md) for details.

### 7. Security Scanner (`@dojops/scanner`)

10 scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom, trivy-license, semgrep) with LLM-powered auto-remediation pipeline, scan comparison (`--compare`), and license compliance checking. The `RemediationEngine` generates confidence-scored fix suggestions for HIGH/CRITICAL findings and can auto-apply safe fixes.

See [Security Scanning](security-scanning.md) for details.

### 8. Chat Sessions (`@dojops/session`)

Multi-turn conversation management with memory windowing, LLM-generated summaries, project context injection, and session persistence.

### 8b. Autonomous Agent Loop (`@dojops/session` + `@dojops/executor`)

The `AgentLoop` implements a ReAct (Reasoning + Acting) pattern — an iterative cycle where the LLM reasons about what to do, calls a tool, observes the result, and repeats until the task is complete. This replaces the one-shot generation model for complex tasks that require project awareness.

**7 agent tools:** `read_file`, `write_file`, `edit_file`, `run_command`, `run_skill`, `search_files`, `done`

The `ToolExecutor` dispatches tool calls to sandboxed operations enforced by `ExecutionPolicy`. File writes are policy-checked, commands run with timeouts, and outputs are truncated at 32KB. The loop terminates on the `done` tool, iteration limit (default 20), or token budget exhaustion.

Available via `dojops auto <prompt>` (CLI), `POST /api/auto` (API), and `/auto <prompt>` (chat). Supports **background mode** (`--background` CLI flag, `background: true` API field) — spawns a detached process and returns a run ID. Check results with `dojops runs show <id>` or `GET /api/auto/runs/:id`. Auto-memory is enabled by default — the agent injects context from previous sessions and records completed tasks.

### 8c. MCP Support (`@dojops/mcp`)

The MCP (Model Context Protocol) package enables the autonomous agent to call tools from external servers — databases, cloud APIs, GitHub, etc. MCP is a Linux Foundation standard supported by Claude Code, Codex, Gemini CLI, and Copilot CLI.

**Architecture:**

- `McpClientManager` — Manages server lifecycle (connect all at agent start, disconnect on completion). Supports `stdio` (local subprocess) and `streamable-http` (remote endpoint) transports via `@modelcontextprotocol/sdk`.
- `McpToolDispatcher` — Bridges MCP tools into the `ToolExecutor` dispatch chain. Parses `mcp__<server>__<tool>` names and routes to the correct server.
- Tool naming: `mcp__<servername>__<toolname>` convention (matches Claude Code). Double-underscore delimiter prevents collisions.

**Config:** `.dojops/mcp.json` (project) + `~/.dojops/mcp.json` (global). Project config overrides global by server name.

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "remote-api": {
      "transport": "streamable-http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

**Integration:** `dojops auto` dynamically loads MCP config, connects all servers, merges MCP tools with the 7 built-in agent tools, passes the dispatcher to `ToolExecutor`, and disconnects in a `finally` block. MCP is optional — connection failures are non-fatal and silently skipped.

**CLI:** `dojops mcp list` (show servers + test connections), `dojops mcp add` (interactive setup), `dojops mcp remove` (remove by name).

### 8d. Streaming Output

All 7 LLM providers support `generateStream()` for real-time token streaming. The `LLMProvider` interface includes an optional `generateStream?(request, onChunk)` method:

| Provider       | Streaming Mechanism                                          |
| -------------- | ------------------------------------------------------------ |
| OpenAI         | `stream: true` on `chat.completions.create()`                |
| Anthropic      | `client.messages.stream()` with `content_block_delta`        |
| DeepSeek       | OpenAI-compatible streaming via `openaiCompatGenerateStream` |
| GitHub Copilot | OpenAI-compatible streaming via `openaiCompatGenerateStream` |
| Ollama         | OpenAI-compatible streaming via `openaiCompatGenerateStream` |
| Gemini         | Not yet streaming (falls back to spinner)                    |

Streaming is used in `dojops "prompt"` for agent-routed generation commands. Structured output (schema/skill requests) and file-writing modes fall back to the spinner path. The `createStreamRenderer()` utility encapsulates ANSI line overwriting for consistent streaming UX.

### 9. REST API & Dashboard (`@dojops/api`)

Express-based API with dependency injection via `createApp(deps)`. Uses `@dojops/skill-registry` to load all built-in + custom skills. 21 endpoints exposing all capabilities over HTTP with API v1 versioning (`/api/v1/` prefix with backward-compatible `/api/` alias, `X-API-Version: 1` header on v1 routes). Vanilla web dashboard with 5 tabs (Overview, Security, Audit, Agents, History). Health endpoint reports `customSkillCount`. Per-route rate limiting and token budget tracking via `TokenTracker`.

See [API Reference](api-reference.md) and [Web Dashboard](dashboard.md).

### 10. CLI (`@dojops/cli`)

Full-lifecycle CLI with rich TUI powered by `@clack/prompts`. Interactive prompts, spinners, styled panels, semantic log levels. Includes `dojops init` (comprehensive repo scanner with 11 CI platforms, IaC, scripts, security detection) and `dojops check` (LLM-powered DevOps config quality analysis).

See [CLI Reference](cli-reference.md).

---

## Design Principles

1. **No blind execution** — Every LLM output is validated before use.
2. **Structured JSON outputs** — Provider-native JSON modes + Zod schemas on all LLM responses.
3. **Schema validation everywhere** — Tool inputs, LLM responses, plan structures, API requests.
4. **Idempotent operations** — Generated configs produce the same result on re-execution. YAML keys are sorted for deterministic output.
5. **Clear separation of concerns** — Orchestration, generation, validation, execution, and auditing are independent layers.
6. **Extensibility** — New skills follow the `BaseSkill<T>` pattern. New agents are registered in the specialist list.
7. **Declarative safety** — `.dops` skills declare their own scope boundaries, risk levels, and execution semantics, enabling automated policy enforcement without hardcoded skill-specific rules.

---

## Data Storage

DojOps stores project state in the `.dojops/` directory:

```
.dojops/
  context.json           Project context v2 (languages, 11 CI platforms, IaC, containers,
                         monitoring/web servers, scripts, security configs, devopsFiles[])
  session.json           Current session state
  plans/                 Saved TaskGraph plans (*.json)
  execution-logs/        Per-execution results (*.json)
  scan-history/          Security scan reports (*.json)
  sessions/              Chat session persistence (*.json)
  skills/                Project-scoped custom skills (.dops files)
  agents/                Project-scoped custom agents (<name>/README.md)
  memory/
    dojops.db            SQLite database (WAL mode): tasks_history, notes, error_patterns
  mcp.json               MCP server configuration (project-scoped)
  policy.yaml            Skill policy (allowedSkills / blockedSkills)
  history/
    audit.jsonl          Hash-chained audit log (append-only)
  lock.json              Execution lock (PID-based)

~/.dojops/
  config.json            User configuration (provider, model, tokens)
  vault.json             AES-256-GCM encrypted secrets vault
  backups/               Config backup snapshots
  skills/                Global custom skills (shared across projects)
  toolchain/             System binary sandbox (installed verification binaries)
  agents/                Global custom agents (shared across projects)
  mcp.json               Global MCP server configuration
```
