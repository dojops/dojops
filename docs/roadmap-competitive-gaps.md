# DojOps CLI — Competitive Gap Analysis & Roadmap

> Generated 2026-03-17 from a full feature audit of DojOps CLI and competitive analysis of 12+ AI agent CLIs.

---

## Current Strengths

These are areas where DojOps has genuine differentiation that no general-purpose AI CLI offers:

| Strength                            | Detail                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| DevOps-specific domain              | 13 built-in skills, 17 specialist agents for infra/CI/CD — no competitor targets this niche    |
| 10 security scanners                | Trivy, Gitleaks, Checkov, Semgrep, Hadolint, ShellCheck, npm/pip audit, SBOM, license scanning |
| Sandboxed execution + policy engine | `ExecutionPolicy` with allowed/denied paths, file size limits, timeout, approval workflows     |
| Hash-chained audit trail            | HMAC-verified JSONL with `dojops history verify` and `dojops history repair`                   |
| Skill marketplace (Hub)             | Publish/install `.dops` skills with SHA-256 integrity verification                             |
| Plan, Review, Apply flow            | Task graph decomposition with risk classification (LOW/MEDIUM/HIGH/CRITICAL)                   |
| Zero telemetry                      | Nothing leaves the machine except LLM API calls. Full local mode with Ollama.                  |
| REST API + web dashboard            | 20 endpoints, metrics aggregation, token tracking — unique among CLI tools                     |
| 6 LLM providers                     | OpenAI, Anthropic, Ollama, DeepSeek, Gemini, GitHub Copilot with fallback chaining             |

---

## Competitive Landscape (March 2026)

| Tool               | Type                     | Stars | Key Differentiator                                                                       |
| ------------------ | ------------------------ | ----- | ---------------------------------------------------------------------------------------- |
| Claude Code        | Terminal agent           | —     | Deepest agentic loop, Auto Memory, subagents, MCP, hooks                                 |
| Codex CLI (OpenAI) | Terminal agent           | 62K   | Rust-based, fastest iteration (553 releases in 10mo), Codex Cloud                        |
| Gemini CLI         | Terminal agent           | 96K   | Most generous free tier (1K req/day), Google Search grounding                            |
| GitHub Copilot CLI | Terminal agent           | —     | GitHub platform integration, cloud delegation (`&`), multi-model                         |
| Aider              | Terminal pair programmer | 39K   | Best BYOM support, AST repo map, git-native, mature                                      |
| Cursor             | AI IDE                   | —     | Parallel agents (8 worktrees), Cloud Agents, Automations, $500M+ ARR                     |
| Cline              | VS Code agent            | 59K   | Plan/Act modes, browser automation, CLI 2.0 headless mode                                |
| Continue.dev       | IDE extension            | 32K   | AI checks as GitHub status checks, per-task model config                                 |
| Amazon Q           | CLI + IDE                | —     | Deep AWS integration, code transformation                                                |
| Warp               | AI terminal              | —     | Terminal replacement, Computer Use, team collaboration                                   |
| Windsurf           | AI IDE                   | —     | Cascade context tracking, live preview click-to-edit (uncertain future post-acquisition) |
| Kiro (Amazon)      | Spec-driven IDE          | —     | Requirements-first approach, multi-day autonomous agents                                 |

---

## Gap Analysis

### Tier 1 — Critical (table stakes in 2026)

#### 1. Autonomous Agent Loop (ReAct Pattern)

**Status:** ✅ Implemented in v1.1.0. `AgentLoop` with 7 tools, `generateWithTools()` on all 6 providers, `ToolExecutor`, `dojops auto`, `/auto` chat command, `POST /api/auto`, super-agent integration.

**What competitors do:** Claude Code, Codex CLI, Gemini CLI, Copilot CLI all run iterative tool-use loops where the LLM reasons about what to do, calls tools (read file, run command, write file), observes results, and repeats until the task is complete.

**What DojOps does today:** One-shot generation. User provides a prompt, LLM generates output in a single call, output is written to disk. The `runRepairLoop` in SafeExecutor is a primitive feedback loop but not a true agent loop.

**Why it matters:** This is THE defining feature of 2026 AI CLIs. Without it, DojOps cannot handle tasks that require understanding the current state of a project before generating configs. Users must manually provide all context.

**Implementation scope:**

- `generateWithTools()` on all 6 LLM providers (native for OpenAI/Anthropic/Gemini, prompt-based fallback for Ollama)
- `ToolExecutor` with 7 tools: `read_file`, `write_file`, `edit_file`, `run_command`, `run_skill`, `search_files`, `done`
- `AgentLoop` ReAct controller in `@dojops/session`
- Evolve `dojops auto` from thin `plan --execute --yes` wrapper to full autonomous mode
- Super-agent integration: change `["plan", prompt, "--execute", "--yes"]` to `["auto", prompt]`

**Files to create:**

- `packages/core/src/llm/tool-types.ts` — ToolDefinition, ToolCall, ToolResult, AgentMessage types
- `packages/core/src/llm/tool-defs.ts` — 7 tool definitions with JSON Schema parameters
- `packages/core/src/llm/prompt-tool-calling.ts` — Prompt-based fallback for providers without native tool support
- `packages/executor/src/tool-executor.ts` — Dispatches tool calls to sandboxed operations
- `packages/session/src/agent-loop.ts` — ReAct loop controller

**Files to modify:**

- `packages/core/src/llm/provider.ts` — Add optional `generateWithTools?()` to LLMProvider interface
- `packages/core/src/llm/openai-compat.ts` — OpenAI-compatible `generateWithTools`
- `packages/core/src/llm/anthropic.ts` — Anthropic `tool_use` content blocks
- `packages/core/src/llm/gemini.ts` — Gemini `functionDeclarations`
- `packages/core/src/llm/ollama.ts` — Prompt-based fallback
- `packages/cli/src/commands/auto.ts` — Full autonomous agent mode
- `dojops-super-agent/src/agent/loop.ts` — One-line change to use `auto`

**Reference:** Full implementation plan at `reports/snuggly-greeting-newt.md`

---

#### 2. Project-Aware Generation (File Reading During Generation)

**Status:** ✅ Resolved by Gap #1. The agent loop uses `read_file` and `search_files` tools to explore the project before and during generation.

**What competitors do:** Every competitor's agent can read existing project files before and during generation. The LLM decides what context it needs.

**What DojOps does today:** `buildAugmentedPrompt()` pre-selects context (repo scan, memory notes, file contents via `--file`). The LLM generates blind against whatever context was pre-injected.

**Why it matters:** Causes hallucinated configs that conflict with existing infrastructure. For example, generating a Terraform config without seeing the existing provider block or state structure.

**Resolution:** Fully addressed by Gap #1 (agent loop). Once the agent can use `read_file` and `search_files` tools, it will explore the project before generating.

---

#### 3. MCP (Model Context Protocol) Support

**Status:** ✅ Implemented in v1.1.3. `@dojops/mcp` package with `McpClientManager`, `McpToolDispatcher`, stdio + streamable-http transports, CLI commands (`mcp list/add/remove`), integrated into `dojops auto`.

**What competitors do:** Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Amazon Q, and Cline all support MCP. It was donated to the Linux Foundation's Agentic AI Foundation and is becoming the universal extension protocol for AI tools.

**Why it matters:** MCP allows DojOps to integrate with external systems (cloud provider APIs, databases, monitoring, ticketing) without building custom integrations. Users configure MCP servers and the agent loop calls them like any other tool. This is the new package ecosystem for AI agent behavior.

**Implementation scope:**

- MCP client in `@dojops/core` or new `@dojops/mcp` package
- Project-scoped config at `.dojops/mcp.json` (list of MCP servers to connect)
- Global config at `~/.dojops/mcp.json`
- MCP tools registered alongside built-in tools in the agent loop's tool list
- Support `stdio` and `sse` transport types (most common)
- CLI: `dojops mcp list`, `dojops mcp add`, `dojops mcp remove`

**Dependencies:** Agent loop (Gap #1) should be implemented first — MCP tools are consumed by the agent loop.

**Example use cases:**

- Connect to AWS MCP server to read current infrastructure state
- Connect to GitHub MCP server to read issues/PRs while generating CI configs
- Connect to a Terraform state MCP server for drift-aware generation
- Connect to Prometheus MCP server to generate alert rules based on actual metrics

---

#### 4. Streaming Output for Generation Commands

**Status:** ✅ Implemented in v1.1.3. `generateStream()` on Anthropic + GitHub Copilot (joining OpenAI, DeepSeek, Ollama). `dojops "prompt"` streams tokens in real-time via `createStreamRenderer()`.

**What competitors do:** All competitors stream tokens as they arrive. Users see output appearing in real-time.

**Why it matters:** Perceived latency is much worse without streaming. Users stare at a spinner for 10-30 seconds instead of watching output appear token by token. For long generations (multi-file plans), the wait can be 30-60 seconds with no feedback.

**Implementation scope:**

- Use `generateStream()` (already on the LLMProvider interface, optional) in generation commands
- Progressive rendering: show tokens as they arrive, format when complete
- For agent loop: stream the LLM's reasoning text while tool calls execute sequentially
- Show real-time tool-use activity: `[reading package.json...]`, `[running terraform validate...]`

**Files to modify:**

- `packages/cli/src/commands/generate.ts` — Use streaming when available
- `packages/cli/src/commands/plan.ts` — Stream decomposition output
- `packages/cli/src/commands/auto.ts` — Stream agent loop thinking + tool activity

---

### Tier 2 — Medium Impact (differentiators becoming expected)

#### 5. Parallel Task Execution ✅

**Status:** Implemented in v1.1.4. Semaphore-based concurrency pool replaces fixed-size chunk batching. `--parallel <n>` flag on `dojops apply`.

**What competitors do:** Cursor runs 8 parallel agents via git worktrees. Claude Code delegates to typed subagents running concurrently. Codex CLI runs parallel tasks.

**Why it matters:** Many tasks in a TaskGraph are independent (e.g., generating a Dockerfile and a GitHub Actions workflow have no dependency). Running them sequentially wastes time.

**Implementation scope:**

- Identify independent task groups in the topological sort (tasks with no mutual dependencies)
- Execute independent groups concurrently via `Promise.all()`
- Respect the topological ordering — dependent tasks still wait for predecessors
- Add `--parallel` flag to `dojops apply` (default: on for independent tasks)
- Progress display: show multiple concurrent spinners or a task status table

**Files to modify:**

- `packages/planner/src/executor.ts` — Parallel execution of independent task groups
- `packages/cli/src/commands/apply.ts` — Parallel progress display

---

#### 6. Cloud / Async Agent Delegation ✅

**Status:** Implemented in v1.1.4. `dojops auto --background` spawns detached agent process. `dojops runs list|show|clean` for management. API supports `background: true` with `GET /api/auto/runs/:id`.

**What competitors do:**

- GitHub Copilot CLI: `&` prefix delegates work to a remote coding agent, freeing the terminal
- Cursor: Cloud Agents run on Cursor's infrastructure while you continue working
- Codex: Codex Cloud lets you launch cloud tasks and apply diffs locally

**Why it matters:** The "fire and forget" pattern lets developers delegate long-running DevOps tasks (full infrastructure setup, multi-service CI/CD) and continue working. Results are reviewed when ready.

**Implementation scope (future):**

- `dojops auto --background "prompt"` — runs agent loop as a background process
- Stores results in `.dojops/runs/<id>/` with status, output, diffs
- `dojops runs list` / `dojops runs show <id>` to check results
- Optional: webhook notification on completion
- Long-term: remote execution on user's own infrastructure via the API server

**Note:** The existing `dojops serve` API server could serve as the backend for this — `POST /api/auto` with a job queue.

---

#### 7. Auto-Enriched Persistent Memory ✅

**Status:** Implemented in v1.1.4. `dojops auto` injects memory context before each run and records tasks after completion. Continuation detection, error pattern awareness. `dojops memory auto on|off` toggle, `dojops memory errors` command.

**What competitors do:** Claude Code's Auto Memory automatically saves learnings, preferences, and project context to `~/.claude/projects/` files without user intervention. The agent decides what's worth remembering.

**Why it matters:** Manual memory management is a friction point. Users forget to save context, and the next session starts from zero. Auto-enrichment means the tool gets smarter over time without user effort.

**Implementation scope:**

- After each successful generation or chat session, prompt the LLM to extract memorable facts
- Auto-save to `memory.db` with source attribution (which session/command generated it)
- TTL-based memory decay — notes not referenced in N sessions are deprioritized
- `dojops memory auto` toggle to enable/disable
- Memory categories: `project-context`, `user-preference`, `error-pattern`, `tool-config`

**Files to modify:**

- `packages/session/src/session.ts` — Post-session memory extraction
- `packages/cli/src/commands/memory.ts` — `auto` subcommand
- `packages/cli/src/commands/generate.ts` — Post-generation memory extraction hook

---

#### 8. Browser / Web Interaction

**Status:** Not implemented.

**What competitors do:** Cline has browser automation (click, type, scroll, screenshot). Warp uses Computer Use for visual verification. Cursor has live preview with click-to-edit.

**Why it matters:** Less critical for DojOps's DevOps domain, but useful for:

- Verifying that a deployed service is reachable after infrastructure changes
- Checking CI/CD dashboard status after pipeline generation
- Reading cloud console UIs for context

**Implementation scope (low priority):**

- Integrate Playwright or Puppeteer as an optional tool in the agent loop
- `browse_url` tool: fetch and render a web page, return text content or screenshot
- Useful for `dojops check` to verify deployed infrastructure health
- Optional dependency — graceful skip if not installed

---

### Tier 3 — Nice-to-Have (competitive polish)

#### 9. Seamless Multi-Model In-Session Switching ✅

**Status:** ✅ Implemented in v1.1.5. `/provider <name>` slash command swaps the LLM provider mid-session while preserving full message history. Message format is already provider-agnostic (`{role, content}`) — no normalization needed. Interactive picker when no name given. Router recreated automatically.

**What competitors do:** Aider and OpenCode allow switching models mid-conversation without losing context. The tool handles message format translation transparently.

**Implementation scope:**

- Message history normalization layer that translates between provider-specific formats
- `/provider <name>` slash command in chat that preserves full history
- Use cheaper models for exploration, expensive models for final generation

---

#### 10. Voice Input ✅

**Status:** ✅ Implemented in v1.1.5. Local speech-to-text via whisper.cpp (no API calls). `/voice` push-to-talk command in chat, `--voice` flag for voice-enabled sessions. Audio recording via SoX `rec`. Auto-detects whisper binary on PATH or via `DOJOPS_WHISPER_BIN`. Optional dependency — graceful error if not installed.

**What competitors do:** Aider has voice-to-code via Whisper. Claude Code has push-to-talk (`/voice`).

**Implementation scope:**

- Integrate OpenAI Whisper API or local whisper.cpp for speech-to-text
- `--voice` flag on chat and generate commands
- Push-to-talk mode in interactive chat

**Priority:** Low — niche feature, but growing in adoption among power users.

---

#### 11. IDE Integration

**Status:** Not implemented. DojOps is terminal-first by design.

**What competitors do:** Every major tool except Aider has VS Code or JetBrains integration. Cursor and Windsurf ARE IDEs.

**Implementation scope (if pursued):**

- VS Code extension for plan visualization (read-only view of TaskGraph)
- Language Server Protocol (LSP) for `.dops` file editing (syntax highlighting, validation, completion)
- VS Code command palette integration: "DojOps: Generate", "DojOps: Plan", "DojOps: Scan"

**Note:** Terminal-first is a valid positioning for the DevOps audience. An LSP for `.dops` files alone would add significant value without building a full IDE extension.

---

#### 12. Free Tier / Hosted Experience

**Status:** DojOps is BYOK (bring your own key), so it's already free beyond LLM costs. No hosted trial experience.

**What competitors do:** Gemini CLI offers 1000 req/day free. Codex CLI is included in ChatGPT Plus. GitHub Copilot has 50 free premium req/mo.

**Implementation scope (if pursued):**

- DojOps Playground: hosted web version using the API server for quick evaluation
- Pre-configured with a trial LLM key (rate-limited)
- Interactive demo scenarios showing the plan/apply workflow

---

## Recommended Implementation Order

| Phase        | Gaps Addressed                       | Estimated Scope | Impact                                                                |
| ------------ | ------------------------------------ | --------------- | --------------------------------------------------------------------- |
| **Phase 1**  | #1 Agent Loop + #2 Project Awareness | ~2 weeks        | Transforms DojOps from config generator to autonomous DevOps engineer |
| **Phase 2**  | #4 Streaming Output                  | ~3 days         | Dramatically improves perceived performance                           |
| **Phase 3**  | #3 MCP Support                       | ~1 week         | Opens the extension ecosystem                                         |
| **Phase 4**  | #5 Parallel Execution                | ~3 days         | Performance win for multi-task plans                                  |
| **Phase 5**  | #7 Auto-Memory                       | ~3 days         | Tool gets smarter over time                                           |
| **Phase 6**  | #6 Background/Async Mode             | ~1 week         | Fire-and-forget workflows                                             |
| **Phase 7+** | #8-12                                | Varies          | Polish and adoption features                                          |

Phase 1 is the highest-leverage change — it closes the two most critical gaps simultaneously and enables Phases 3-7 (MCP tools, parallel agents, and background mode all build on the agent loop).

---

## Key Trends to Track

1. **MCP as universal standard** — Donated to Linux Foundation's Agentic AI Foundation. Rapidly becoming the "USB for AI tools." Not supporting it will increasingly isolate DojOps.

2. **Cloud agents / async delegation** — The shift from synchronous pairing to asynchronous delegation. Copilot's `&`, Cursor Cloud Agents, Codex Cloud, Kiro's multi-day agents.

3. **Skills/plugins as the new package ecosystem** — Claude Code Skills, Codex Skills, Copilot Agent Skills. DojOps's `.dops` skill system and Hub are already ahead here.

4. **Spec-driven development** — Kiro's requirements-first approach. DojOps's plan → review → apply flow is philosophically aligned and could lean into this more explicitly.

5. **CI/CD headless mode** — Cline CLI 2.0 and Continue.dev run agents in GitHub Actions. DojOps's `dojops serve` API + `--non-interactive` mode already enable this, but it's not marketed.

6. **Credit-based pricing dominance** — Every tool is moving to credits/premium requests. DojOps's BYOK model is a competitive advantage for cost-conscious teams.
