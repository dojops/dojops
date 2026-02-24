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
  |   Deep    |  Layer 3: Optional external tool verification (--verify):
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

| Provider  | Mechanism                                         |
| --------- | ------------------------------------------------- |
| OpenAI    | `response_format: { type: "json_object" }`        |
| Anthropic | JSON prefill technique (assistant message prefix) |
| Ollama    | `format: "json"`                                  |
| DeepSeek  | OpenAI-compatible `response_format`               |
| Gemini    | `responseMimeType: "application/json"`            |

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

Optional external tool validation (`--verify` flag):

| Tool       | Verifier                   | What It Checks                                       |
| ---------- | -------------------------- | ---------------------------------------------------- |
| Terraform  | `terraform validate`       | HCL syntax, provider requirements, resource validity |
| Dockerfile | `hadolint`                 | Dockerfile best practices, security issues           |
| Kubernetes | `kubectl --dry-run=client` | Manifest structure, API version compatibility        |

Verification is opt-in and gracefully skips if external tools are not installed. Failed verification blocks execution.

### Layer 4: Policy Engine

`ExecutionPolicy` provides fine-grained control:

- **Write permissions** — `allowWrite` must be `true` for any file operations
- **Path allowlists** — `allowedPaths` restricts where files can be written
- **Path denylists** — `deniedPaths` blocks specific paths (takes precedence)
- **Environment isolation** — `envVars` controls available environment variables
- **Timeouts** — `timeoutMs` prevents runaway operations
- **Size limits** — `maxFileSize` prevents oversized file writes

### Layer 5: Approval Workflows

Before any write operation, the `ApprovalHandler` is invoked:

- **Interactive mode** — Shows a diff preview and prompts the user for confirmation
- **Auto-approve** — For `--yes` flag and automated pipelines
- **Auto-deny** — For `--dry-run` and testing

The approval context includes file paths, content preview, and tool name.

### Layer 6: Sandboxed Execution

`SandboxedFs` wraps all file operations:

- Path validation against the execution policy
- File size validation before writes
- Atomic write operations
- Per-file audit logging (path, size, timestamp, operation)

### Layer 7: Immutable Audit Log

Every operation produces a hash-chained audit entry:

- **Append-only** — Entries are appended to `.dojops/history/audit.jsonl`
- **Hash chain** — Each entry's hash includes the previous entry's hash (SHA-256)
- **Tamper detection** — `dojops history verify` recomputes all hashes and detects any modifications
- **Structured entries** — Each entry includes seq, timestamp, command, tool, status, verification result

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

- 6 scanners covering vulnerabilities, dependencies, IaC issues, and secrets
- Exit codes 6 (HIGH) and 7 (CRITICAL) for CI/CD integration
- LLM-powered remediation with path-traversal protection

See [Security Scanning](security-scanning.md) for details.

---

## Best Practices

1. **Always use `--verify`** in production for Terraform, Dockerfile, and Kubernetes tools
2. **Review diffs** before approving write operations in interactive mode
3. **Run `dojops history verify`** periodically to check audit trail integrity
4. **Use `--dry-run`** to preview changes before applying
5. **Restrict `allowedPaths`** in execution policies to limit blast radius
6. **Run `dojops scan`** after applying changes to check for introduced vulnerabilities
