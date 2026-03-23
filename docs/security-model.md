# Security Model

DojOps implements defense-in-depth with seven layers between LLM output and infrastructure changes. No LLM output is trusted — every response crosses a trust boundary and is validated at every subsequent layer.

---

## Defense-in-Depth Layers

```
  LLM Response
       |
  +----v-----+
  | Structured|  Layer 1: Provider-native JSON mode
  |  Output   |  (OpenAI response_format, Anthropic prefill, Ollama format)
  +----+------+
       |
  +----v-----+
  |  Input    |  Layer 2: Zod schema validation on every tool input
  | Validation|  and LLM response (parseAndValidate)
  +----+------+
       |
  +----v------+
  |   Deep    |  Layer 3: External tool verification (on by default, --skip-verify):
  |Verification| terraform validate, hadolint, kubectl dry-run
  +----+------+
       |
  +----v-----+
  |  Policy   |  Layer 4: ExecutionPolicy controls write permissions,
  |  Engine   |  allowed/denied paths, env vars, timeouts, file size limits
  +----+------+
       |
  +----v-----+
  | Approval  |  Layer 5: ApprovalHandler with diff preview
  | Workflow  |  (auto-approve, auto-deny, interactive callback)
  +----+------+
       |
  +----v-----+
  | Sandboxed |  Layer 6: SandboxedFs restricts file operations
  | Execution |  to policy-allowed paths with per-file audit logging
  +----+------+
       |
  +----v-----+
  | Immutable |  Layer 7: Hash-chained JSONL audit trail (SHA-256)
  | Audit Log |  with tamper detection via `dojops history verify`
  +----------+
```

---

## Layer Details

### Layer 1: Structured Output Enforcement

Every LLM request uses provider-native JSON modes to constrain output format:

| Provider       | Mechanism                                           |
| -------------- | --------------------------------------------------- |
| OpenAI         | `response_format: { type: "json_object" }`          |
| Anthropic      | JSON prefill technique (assistant message prefix)   |
| Ollama         | `format: "json"`                                    |
| DeepSeek       | OpenAI-compatible `response_format`                 |
| Gemini         | `responseMimeType: "application/json"`              |
| GitHub Copilot | OpenAI-compatible `response_format` via Copilot API |

This prevents free-text responses and ensures the LLM produces parseable JSON.

### Layer 2: Schema Validation

All LLM responses pass through `parseAndValidate()`:

1. **Markdown stripping** — Removes code fences that LLMs sometimes add
2. **JSON parsing** — `JSON.parse()` with error handling
3. **Zod validation** — `safeParse()` against the expected schema

If validation fails, the response is rejected before any execution occurs. This applies to:

- Tool input schemas
- Tool output schemas
- TaskGraph schemas
- API request schemas

### Layer 3: Deep Verification

External tool validation (enabled by default in CLI; `--skip-verify` to disable):

| Tool           | Verifier                   | What It Checks                                         |
| -------------- | -------------------------- | ------------------------------------------------------ |
| Terraform      | `terraform validate`       | HCL syntax, provider requirements, resource validity   |
| Dockerfile     | `hadolint`                 | Dockerfile best practices, security issues             |
| Kubernetes     | `kubectl --dry-run=client` | Manifest structure, API version compatibility          |
| GitHub Actions | Structure lint (built-in)  | `on` trigger, `jobs` section, `runs-on`, step validity |
| GitLab CI      | Structure lint (built-in)  | Job `script` fields, `stages` array, stage references  |

Verification runs by default for CLI commands (`apply`, `plan --execute`). It gracefully skips if external tools are not installed. Failed verification blocks execution. The SDK default (`skipVerification: true`) remains unchanged for programmatic callers.

### Layer 3b: DOPS Scope Enforcement

`.dops` skills can declare explicit write boundaries via the `scope` section:

```yaml
scope:
  write: ["{outputPath}/main.tf", "{outputPath}/variables.tf"]
```

At file-write time, `writeFiles()` validates each resolved path against the expanded `scope.write` patterns. Writes to paths not covered by any scope pattern are rejected with an error. This provides skill-level write restriction independent of the global `ExecutionPolicy`, enabling defense-in-depth: even if the policy allows a broad set of paths, individual skills are constrained to their declared scope.

Path traversal (`..`) in scope patterns is rejected at parse time by the Zod schema validator.

### Layer 4: Policy Engine

`ExecutionPolicy` provides fine-grained control:

- **Write permissions** — `allowWrite` must be `true` for any file operations
- **DevOps write allowlist** — When no explicit `allowedPaths` are set, only DevOps files (CI configs, Dockerfiles, Terraform, Kubernetes manifests, etc.) can be written. This prevents LLM-generated code from mutating application source files. Bypass with `--allow-all-paths`
- **Path allowlists** — `allowedPaths` restricts where files can be written (takes precedence over DevOps allowlist)
- **Path denylists** — `deniedPaths` blocks specific paths (takes precedence over everything)
- **Environment isolation** — `allowEnvVars` declares allowed environment variables (advisory — not enforced at runtime; use `filterEnvVars(policy)` to apply manually)
- **Network access** — `allowNetwork` declares network permission intent (advisory — not enforced at runtime; reserved for future OS-level sandboxing)
- **Timeouts** — `timeoutMs` prevents runaway operations
- **Size limits** — `maxFileSize` prevents oversized file writes

### Layer 5: Approval Workflows

Before any write operation, the `ApprovalHandler` is invoked:

- **Interactive mode** — Shows a diff preview and prompts the user for confirmation
- **Auto-approve** — For `--yes` flag and automated pipelines
- **Auto-deny** — For `--dry-run` and testing

The approval context includes file paths, content preview, and tool name.

### Layer 6: Sandboxed Execution

`SandboxedFs` wraps file operations with policy enforcement:

- Path validation against the execution policy (`checkWriteAllowed`)
- File size validation before writes (`checkFileSize`)
- Atomic write operations (temp-file + `fs.renameSync` — POSIX atomic rename prevents partial writes on crash)
- Read-path validation against denied paths (with symlink resolution)

`SafeExecutor` also performs pre-execution path checks on declared output files and post-hoc validation on actually written files. Per-file audit logging (files written/modified, timestamps, duration) is recorded in execution audit entries.

All 31 built-in skills and custom skills also use `atomicWriteFileSync()` from `@dojops/sdk` for direct file writes outside the sandbox.

### Layer 7: Immutable Audit Log

Every operation produces a hash-chained audit entry:

- **Append-only** — Entries are appended to `.dojops/history/audit.jsonl` (JSONL format, SIEM-compatible)
- **Hash chain** — Each entry's hash includes the previous entry's hash (SHA-256)
- **Tamper detection** — `dojops history verify` recomputes all hashes and detects any modifications
- **Structured entries** — Each entry includes seq, timestamp, command, tool, status, verification result
- **Random entry IDs** — `HistoryStore` uses `crypto.randomUUID()`-based 12-char hex IDs instead of sequential counters, preventing ID prediction and reuse on restart

---

## API Authentication

The REST API supports optional API key authentication:

- **Key generation** — `dojops serve credentials` generates a `crypto.randomBytes(32)` base64url key and saves it to `~/.dojops/server.json` (mode `0o600`)
- **Key loading** — Server loads key from `DOJOPS_API_KEY` env var or `~/.dojops/server.json` at startup
- **Timing-safe comparison** — All key comparisons use `crypto.timingSafeEqual` to prevent timing attacks
- **Dual header support** — Accepts `Authorization: Bearer <key>` or `X-API-Key: <key>`
- **Health endpoint info-leak prevention** — Unauthenticated callers to `/api/health` receive only `{ status, authRequired, timestamp }`; full diagnostic payload (provider, tools, memory, uptime) requires authentication
- **autoApprove guard** — The `POST /api/plan` endpoint's `autoApprove` flag requires server authentication to be configured (`403` if no server key exists), preventing blind auto-approval via unauthenticated API calls
- **Dashboard login flow** — The web dashboard stores the API key in `sessionStorage`, injects `X-API-Key` headers on all API calls, and shows a login overlay on 401/403 responses

---

## Input Validation Hardening

Several API-layer input validation measures prevent abuse:

- **Session ID format** — Chat session IDs are validated against `/^chat-[a-f0-9]{8,16}$/` with a `.max(64)` Zod constraint to prevent log injection and resource abuse
- **Log injection prevention** — Session IDs in log output are sanitized (strip `\r\n\t`, cap at 64 chars) to prevent log forging
- **Session hydration validation** — When loading sessions from disk at startup, each session's `id` is validated against `isValidSessionId()` to prevent corrupted data from entering memory
- **parseInt NaN guards** — History route query parameters (`limit`, `offset`) use `Number.isFinite()` guards to prevent `NaN` propagation from malformed input
- **Scan timeout** — Scan operations are wrapped in `Promise.race` with a configurable timeout (`DOJOPS_SCAN_TIMEOUT_MS`, default 120s) to prevent unbounded execution
- **MetricsAggregator bounds** — File reads skip files >10MB, audit entries are capped at the last 10,000 lines, and `topIssues` is capped at 100 entries to prevent memory exhaustion
- **Atomic session persistence** — Chat session writes use atomic file operations (write `.tmp` then `fs.renameSync`) to prevent partial writes on crash

---

## Trust Boundary

```
 UNTRUSTED                    TRUST BOUNDARY                    TRUSTED
+-----------+            +--------------------+            +-------------+
| LLM       |  ----->    | Structured Output  |  ----->    | Validated   |
| Response  |            | + Schema Validation|            | Tool Input  |
+-----------+            +--------------------+            +-------------+
```

LLM output is treated as untrusted external input. The trust boundary is at the Structured Output + Schema Validation layers. Only data that passes both layers enters the trusted execution pipeline.

---

## Concurrency Safety

PID-based execution locking prevents concurrent mutations:

- **Lock file** — `.dojops/lock.json` containing `{ pid, command, timestamp }`
- **Mutual exclusion** — Only one `apply`, `destroy`, or `rollback` operation at a time
- **Stale lock cleanup** — If the locking PID is dead, the lock is automatically removed
- **Exit code 4** — Returned when a lock conflict is detected

---

## Security Scanning

Beyond the execution pipeline, DojOps provides proactive security scanning via `@dojops/scanner`:

- 10 scanners covering vulnerabilities, dependencies, IaC issues, secrets, shell scripts, SAST, license compliance, and SBOM generation
- Exit codes 6 (HIGH) and 7 (CRITICAL) for CI/CD integration
- LLM-powered remediation with path-traversal protection

See [Security Scanning](security-scanning.md) for details.

---

## Skill Isolation

Custom skills execute through the same `SafeExecutor` pipeline as built-in skills (inheriting `maxFileSize`, `timeoutMs`, DevOps write allowlist, and per-file audit logging), plus three additional security controls:

### Verification Command Whitelist

The `verification.command` field in skill manifests can only invoke whitelisted binaries:

```
terraform, kubectl, helm, ansible-lint, docker, hadolint,
yamllint, jsonlint, shellcheck, tflint, kubeval, conftest,
checkov, trivy, kube-score, polaris
```

Any other command (e.g., `curl`, `rm`, `bash`) is rejected at runtime with a descriptive error.

### Permission Enforcement

The `permissions.child_process` field controls whether verification commands execute:

| Value        | Behavior                                            |
| ------------ | --------------------------------------------------- |
| `"required"` | Command is checked against whitelist, then executed |
| `"none"`     | Command is never executed (skip)                    |
| _(omitted)_  | Default-safe: command is never executed             |

This ensures custom skills cannot execute shell commands unless they explicitly declare `child_process: "required"` AND the command is whitelisted.

### Path Traversal Prevention

File paths in `files[].path` and `detector.path` are validated at schema level — any segment containing `..` is rejected. This prevents custom skills from writing to or detecting files outside the project directory (e.g., `../../etc/passwd`).

### Skill Hash Integrity

Each custom skill has a SHA-256 hash computed from its `.dops` content. This hash is pinned into plans at creation time and validated on `--resume` and `--replay` to detect skill modifications between plan creation and execution.

### Replay Validation

`dojops apply --replay` enforces deterministic reproducibility by:

1. Forcing `temperature: 0` via a `DeterministicProvider` wrapper
2. Validating `provider` and `model` match the plan's execution context
3. Validating `systemPromptHash` for custom skill tasks to detect prompt drift

If any check fails, replay is aborted unless `--force` overrides the check. The `--yes` flag intentionally does **not** bypass replay validation, since deterministic replay requires an exact environment match to produce meaningful results.

---

## Plan Risk Classification

Plans are automatically classified into risk levels based on tool types and keyword analysis:

- **LOW** — CI/CD and monitoring tools (GitHub Actions, GitLab CI, Makefile, Prometheus)
- **MEDIUM** — Infrastructure tools (Terraform, Dockerfile, Kubernetes, Helm, Docker Compose, Ansible, Nginx, Systemd)
- **HIGH** — Any task mentioning IAM, security groups, production, secrets, credentials, RBAC, roles, or permissions

HIGH risk plans require explicit confirmation even with `--yes` (unless `--force` is also set), adding a safety gate before potentially dangerous operations.

### DOPS-Declared Risk

`.dops` skills can also self-classify their risk level via the `risk` frontmatter section:

```yaml
risk:
  level: MEDIUM
  rationale: "Infrastructure changes may affect cloud resources"
```

This metadata is exposed via `DopsRuntime.metadata.riskLevel` and can be consumed by planners and approval workflows. The declared risk level complements the CLI's keyword-based classifier — the CLI classifies plans, while `.dops` skills classify individual skills. When both are present, the higher risk level takes precedence.

---

## Drift Awareness

Before execution, `apply` displays informational warnings for stateful tools (Terraform, Kubernetes, Helm, Ansible) reminding users that DojOps validates local config files but does not inspect remote state. Users are advised to run the appropriate tool-native drift check (e.g., `terraform plan`, `kubectl diff`) before applying.

---

## Plan Snapshot Freezing

Plans capture an execution context snapshot at creation time:

- **DojOps version** — Detects version mismatches between plan creation and execution
- **Policy hash** — SHA-256 of the execution policy, detecting policy changes
- **Tool versions** — Per-tool version metadata for reproducibility

In `--replay` mode, version mismatches are blocking errors. In normal `apply` mode, mismatches produce informational warnings.

---

## Encrypted Secrets Vault

DojOps stores API tokens encrypted at rest using AES-256-GCM:

- **Key derivation** — User passphrase → scrypt (N=2^14, r=8, p=1) → 256-bit key
- **Encryption** — Random 16-byte IV, AES-256-GCM with 16-byte auth tag
- **Storage** — Encrypted tokens in `~/.dojops/vault.json` (mode `0o600`)
- **Environment variable** — `DOJOPS_VAULT_KEY` for CI/CD and non-interactive use
- **Automatic migration** — `dojops provider add` encrypts tokens into the vault; plaintext tokens in `config.json` are not used when the vault is active

This eliminates plaintext API token storage, which is a common credential exposure vector in developer workstations and CI pipelines.

---

## Best Practices

1. **Keep verification enabled** (the default) in production for Terraform, Dockerfile, and Kubernetes tools. Only use `--skip-verify` for speed during development
2. **Review diffs** before approving write operations in interactive mode
3. **Run `dojops history verify`** periodically to check audit trail integrity
4. **Use `--dry-run`** to preview changes before applying
5. **Restrict `allowedPaths`** in execution policies to limit blast radius
6. **Run `dojops scan`** after applying changes to check for introduced vulnerabilities
7. **Enable the encrypted vault** for API token storage — avoid plaintext tokens in config files
