# Architecture

DojOps is designed as a modular, layered DevOps agent system — not a simple chatbot that generates bash commands. It is a structured, safe, extensible orchestration framework with 13 built-in DevOps tools, a custom tool system for extending with additional tools, 17 specialist agents, sandboxed execution, approval workflows, and hash-chained audit trails.

---

## High-Level Data Flow

```
User
 |
 v
CLI (@clack/prompts TUI) / REST API (Express)
 |
 v
Agent Router (17 specialist agents, keyword confidence scoring)
 |
 v
Planner Engine (LLM -> TaskGraph -> topological execution)
 |
 v
Module Registry (13 built-in modules + custom modules, unified discovery)
 |
 v
Module SDK Layer (BaseModule<T>, Zod validation)
 |
 v
Execution Engine (Sandboxed, policy-enforced, approval-gated, audit-logged)
```

---

## Package Architecture

DojOps is a pnpm monorepo with Turbo build orchestration. TypeScript (ES2022, CommonJS). All packages use the `@dojops/*` scope.

### 11 Packages

```
@dojops/cli            CLI entry point + rich TUI (@clack/prompts)
@dojops/api            REST API (Express) + web dashboard + factory functions
@dojops/module-registry Module registry + custom module system (discovers built-in + custom modules)
@dojops/planner        TaskGraph decomposition + topological executor
@dojops/executor       SafeExecutor: sandbox + policy engine + approval + audit log
@dojops/runtime        13 built-in DevOps modules as .dops v2 files (DopsRuntime)
@dojops/scanner        10 security scanners + remediation engine
@dojops/session        Chat session management + memory + context injection
@dojops/context        Context7 documentation augmentation for v2 modules
@dojops/core           LLM abstraction + 6 providers + 17 specialist agents + CI debugger + infra diff + DevOps checker
@dojops/sdk            BaseModule<T> abstract class with Zod validation + optional verify() + file-reader utilities
```

### Dependency Flow

```
@dojops/cli
  +-- @dojops/api
  |     +-- @dojops/module-registry
  |     |     +-- @dojops/runtime
  |     |     |     +-- @dojops/core
  |     |     |     +-- @dojops/sdk
  |     |     +-- @dojops/core
  |     |     +-- @dojops/sdk (zod)
  |     +-- @dojops/planner
  |     |     +-- @dojops/core
  |     |           +-- @dojops/sdk (zod)
  |     +-- @dojops/executor
  |     |     +-- @dojops/sdk
  |     +-- @dojops/scanner
  |     +-- @dojops/context
  |     |     +-- @dojops/core
  |     +-- @dojops/session
  |           +-- @dojops/core
```

**Simplified linear flow:**

```
cli -> api -> module-registry -> runtime -> core -> sdk
          -> planner -> executor
          -> scanner
          -> context -> core
          -> session -> core
```

---

## Layer Descriptions

### 1. LLM Layer (`@dojops/core`)

Abstraction over six LLM providers with structured JSON output:

| Provider       | JSON Mode Mechanism                                     | SDK                 |
| -------------- | ------------------------------------------------------- | ------------------- |
| OpenAI         | `response_format: { type: "json_object" }`              | `openai`            |
| Anthropic      | JSON prefill technique                                  | `@anthropic-ai/sdk` |
| Ollama         | `format: "json"`                                        | `ollama`            |
| DeepSeek       | OpenAI-compatible API with custom `baseURL`             | `openai`            |
| Gemini         | `responseMimeType: "application/json"`                  | `@google/genai`     |
| GitHub Copilot | OpenAI-compatible API with Copilot `baseURL` + JWT auth | `openai`            |

Key interface:

```typescript
interface LLMProvider {
  name: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  listModels?(): Promise<string[]>;
}
```

All responses pass through `parseAndValidate()` — strips markdown fences, `JSON.parse`, Zod `safeParse` — ensuring every LLM output conforms to the expected schema. All 6 providers support `temperature` passthrough for deterministic reproducibility (conditionally included in API calls only when explicitly set). A `DeterministicProvider` wrapper forces `temperature: 0` on every call for replay mode (`apply --replay`). A `FallbackProvider` wraps multiple providers and automatically falls back to the next on failure (configured via `--fallback-provider` flag or `DOJOPS_FALLBACK_PROVIDER` env var). The `GitHubCopilotProvider` creates a new OpenAI client per `generate()` call to use the freshest JWT (tokens expire every ~30 min).

### 2. Multi-Agent System (`@dojops/core`)

17 built-in specialist agents with keyword-based routing and confidence scoring, plus support for custom agents. The `AgentRouter` scores prompts against each agent's keyword list and routes to the highest-confidence match. If no agent exceeds the threshold, it falls back to the general-purpose `DevOpsAgent`.

Custom agents are defined as structured `README.md` files in `.dojops/agents/<name>/` (project) or `~/.dojops/agents/<name>/` (global). They can be created via LLM (`dojops agents create "description"`) or manually (`dojops agents create --manual`). Custom agents participate in the same keyword-based routing as built-in agents and can override built-in agents by name. Discovery is handled by `@dojops/tool-registry`.

Additionally, three specialized analyzers (not routed via `AgentRouter`) provide structured analysis:

- **`CIDebugger`** — CI log diagnosis producing `CIDiagnosis` (error type, root cause, fixes)
- **`InfraDiffAnalyzer`** — Infrastructure diff analysis producing `InfraDiffAnalysis` (risk, cost, security)
- **`DevOpsChecker`** — DevOps config quality analysis producing `CheckReport` (score 0-100, findings, missing files)

See [Specialist Agents](agents.md) for the full agent list.

### 3. Task Planner (`@dojops/planner`)

LLM-powered goal decomposition into structured, dependency-aware task graphs. Uses Kahn's algorithm for topological execution ordering, `$ref:<taskId>` for inter-task data wiring, and `completedTaskIds` for resume after partial failures.

See [Task Planner](planner.md) for details.

### 4. Module SDK (`@dojops/sdk`)

Abstract `BaseModule<T>` class with Zod input schema validation, abstract `generate()` for LLM generation, optional `execute()` for file writes, and optional `verify()` for external tool validation. Also provides `readExistingConfig()`, `backupFile()`, `atomicWriteFileSync()` (temp + rename for crash-safe writes), and `restoreBackup()` utilities.

See [DevOps Tools](tools.md) for the module pattern.

### 4b. DOPS Runtime (`@dojops/runtime`)

The DOPS runtime processes `.dops v2` module files — a declarative format combining YAML frontmatter with markdown prompt sections for raw content generation with Context7 integration.

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

- `DopsRuntime` — Runtime class for `.dops v2` modules
- `parseDopsFile()` / `parseDopsString()` — Parsers for `.dops v2` files
- `compilePrompt()` — Compiles prompts with `{outputGuidance}`, `{bestPractices}`, `{context7Docs}`, `{projectContext}` variables
- `stripCodeFences()` — Strips markdown code fences from raw LLM output before writing
- `DocProvider` interface — Enables Context7 documentation augmentation for v2 tools
- `DopsRuntime.risk` — Returns declared risk or defaults to `{ level: "LOW", rationale: "No risk classification declared" }`
- `DopsRuntime.metadata` — Includes `riskLevel`, `systemPromptHash`, `toolHash` for audit integration
- **Scope enforcement** — `writeFiles()` validates resolved paths against `scope.write` patterns after `{var}` expansion; out-of-scope writes throw
- **Update strategy** — `preserve_structure` injects additional prompt instructions to maintain existing config organization

### 5. DevOps Tools (`@dojops/runtime`)

13 built-in tools covering CI/CD, IaC, containers, monitoring, and system services. All 13 are now `.dops v2` modules in `packages/runtime/modules/`, processed by `DopsRuntimeV2` — generating raw file content directly via LLM with Context7 documentation augmentation. All tools support updating existing configs via auto-detection, `existingContent` input, and `.bak` backup before overwrite. All file writes use `atomicWriteFileSync()` for crash safety. Every `execute()` returns `filesWritten`/`filesModified` for rollback tracking.

See [DevOps Tools](tools.md) for the full tool list.

### 5b. Module Registry (`@dojops/module-registry`)

Unified registry layer between consumers (Planner, Executor, CLI, API) and module implementations. Combines all 13 built-in modules with custom modules discovered from disk:

- **`.dops` module discovery** — Discovers `.dops v2` modules from `~/.dojops/modules/` (global) and `.dojops/modules/` (project)
- **Module validation** — Zod schema validates `.dops` frontmatter
- **Module policy** — `.dojops/policy.yaml` supports `allowedModules` and `blockedModules` lists
- **Audit enrichment** — Custom module executions include `toolType`, `toolSource`, `toolVersion`, `toolHash`, and `systemPromptHash` in audit entries
- **Module isolation** — Verification commands restricted to a whitelist of 33 allowed binaries, `child_process` permission must be `"required"` for execution, path traversal (`..`) blocked in file paths and detector paths
- **OnBinaryMissing callback** — When a verification binary is not found, the callback triggers automatic installation via `dojops toolchain install` and retries verification
- **Unified interface** — `ModuleRegistry.getAll()` returns `DevOpsModule[]`, so Planner, Executor, and API remain unchanged

### 6. Execution Engine (`@dojops/executor`)

Orchestrates generate -> verify -> approve -> execute with policy enforcement, sandboxed file operations, and audit logging.

See [Execution Engine](execution-engine.md) for details.

### 7. Security Scanner (`@dojops/scanner`)

10 scanners (npm-audit, pip-audit, trivy, gitleaks, checkov, hadolint, shellcheck, trivy-sbom, trivy-license, semgrep) with LLM-powered remediation, scan comparison (`--compare`), and license compliance checking.

See [Security Scanning](security-scanning.md) for details.

### 8. Chat Sessions (`@dojops/session`)

Multi-turn conversation management with memory windowing, LLM-generated summaries, project context injection, and session persistence.

### 9. REST API & Dashboard (`@dojops/api`)

Express-based API with dependency injection via `createApp(deps)`. Uses `@dojops/tool-registry` to load all built-in + custom tools. 20 endpoints exposing all capabilities over HTTP with API v1 versioning (`/api/v1/` prefix with backward-compatible `/api/` alias, `X-API-Version: 1` header on v1 routes). Vanilla web dashboard with 5 tabs (Overview, Security, Audit, Agents, History). Health endpoint reports `customToolCount`. Per-route rate limiting and token budget tracking via `TokenTracker`.

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
6. **Extensibility** — New tools follow the `BaseTool<T>` pattern. New agents are registered in the specialist list.
7. **Declarative safety** — `.dops` modules declare their own scope boundaries, risk levels, and execution semantics, enabling automated policy enforcement without hardcoded tool-specific rules.

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
  modules/               Project-scoped custom modules (.dops files)
  agents/                Project-scoped custom agents (<name>/README.md)
  memory/
    dojops.db            SQLite database (WAL mode): tasks_history, notes, error_patterns
  policy.yaml            Module policy (allowedModules / blockedModules)
  history/
    audit.jsonl          Hash-chained audit log (append-only)
  lock.json              Execution lock (PID-based)

~/.dojops/
  config.json            User configuration (provider, model, tokens)
  vault.json             AES-256-GCM encrypted secrets vault
  backups/               Config backup snapshots
  modules/               Global custom modules (shared across projects)
  toolchain/             System binary sandbox (installed verification binaries)
  agents/                Global custom agents (shared across projects)
```
