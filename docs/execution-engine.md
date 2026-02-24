# Execution Engine

The `@dojops/executor` package provides safe, auditable execution of generated DevOps configurations through policy enforcement, approval workflows, sandboxed file operations, and hash-chained audit logging.

---

## Pipeline Overview

```
Input
  |
  v
validate() ---- Zod schema validation of tool input
  |
  v
generate() ---- LLM generates structured output
  |
  v
verify() ------ Optional external tool validation (terraform validate, hadolint, kubectl)
  |              Skipped if tool doesn't implement verify() or skipVerification=true
  v
approve() ----- Approval workflow (auto-approve, auto-deny, or interactive callback)
  |              Shows diff preview before write operations
  v
execute() ----- SandboxedFs writes files within policy-allowed paths
  |
  v
audit() ------- AuditEntry logged with hash chain (SHA-256)
```

---

## SafeExecutor

The `SafeExecutor` orchestrates the full pipeline. It receives:

- A `BaseTool` instance
- An `ExecutionPolicy`
- An `ApprovalHandler`

And produces audit entries for every operation, whether successful, failed, or denied.

---

## Execution Policy

The `ExecutionPolicy` controls what the executor is allowed to do:

| Field              | Type                   | Default   | Description                                      |
| ------------------ | ---------------------- | --------- | ------------------------------------------------ |
| `allowWrite`       | boolean                | `false`   | Whether file writes are permitted                |
| `allowedPaths`     | string[]               | `[]`      | Paths the executor may write to (glob patterns)  |
| `deniedPaths`      | string[]               | `[]`      | Paths the executor must not write to             |
| `envVars`          | Record<string, string> | `{}`      | Environment variables available during execution |
| `timeoutMs`        | number                 | `30000`   | Maximum execution time (milliseconds)            |
| `maxFileSize`      | number                 | `1048576` | Maximum file size in bytes (1MB default)         |
| `skipVerification` | boolean                | `true`    | Skip the verify step (opt-in via `--verify`)     |

### Path Resolution

- `allowedPaths` are checked first — the file path must match at least one allowed pattern
- `deniedPaths` are checked second — any match blocks the write, even if allowed
- Denied paths take precedence over allowed paths

---

## Approval Handlers

The executor delegates write approval to an `ApprovalHandler`:

```typescript
interface ApprovalHandler {
  approve(context: ApprovalContext): Promise<boolean>;
}
```

Three implementations:

| Handler                   | Behavior                       | Use Case                                  |
| ------------------------- | ------------------------------ | ----------------------------------------- |
| `AutoApproveHandler`      | Always returns `true`          | `--yes` flag, automated pipelines         |
| `AutoDenyHandler`         | Always returns `false`         | `--dry-run`, testing                      |
| `CallbackApprovalHandler` | Calls a user-provided function | Interactive CLI prompts with diff preview |

The `ApprovalContext` includes the tool name, file paths, and a preview of changes so users can make informed decisions.

---

## Sandboxed Filesystem

`SandboxedFs` wraps Node.js `fs` operations with policy enforcement:

- **Path restriction** — Only writes to paths allowed by the `ExecutionPolicy`
- **Size limits** — Rejects files exceeding `maxFileSize`
- **Per-file audit** — Each file operation is logged with path, size, and timestamp
- **Atomic writes** — Files are written atomically to prevent partial writes on failure

---

## Verification Pipeline

Tools that implement `verify()` can validate their generated output with external tools:

| Tool       | Verifier    | Command                                     |
| ---------- | ----------- | ------------------------------------------- |
| Terraform  | `terraform` | `terraform validate` in a temp directory    |
| Dockerfile | `hadolint`  | `hadolint Dockerfile`                       |
| Kubernetes | `kubectl`   | `kubectl --dry-run=client -f manifest.yaml` |

### Verification Behavior

1. **Opt-in** — Verification runs only when `skipVerification=false` (enabled via `--verify`)
2. **Tool check** — If the tool doesn't implement `verify()`, the step is skipped
3. **Binary check** — If the external binary isn't installed, verification is skipped with a warning
4. **Blocking** — Failed verification blocks execution (returns `VerificationResult.valid=false`)
5. **Logged** — Verification results are included in the audit entry

---

## Audit Trail

Every operation produces an `AuditEntry`:

```typescript
interface AuditEntry {
  seq: number; // Sequential entry number
  timestamp: string; // ISO 8601
  command: string; // "generate" | "apply" | "scan" | etc.
  tool?: string; // Tool name if applicable
  status: "success" | "failure" | "cancelled";
  details: Record<string, unknown>;
  verificationResult?: VerificationResult;
  previousHash: string; // Hash of the previous entry
  hash: string; // SHA-256 of this entry
}
```

### Hash Chain

Audit entries form a hash chain:

1. Each entry's `hash` is computed as `SHA-256(seq + timestamp + command + status + previousHash)`
2. The `previousHash` links to the prior entry
3. The chain can be verified end-to-end with `dojops history verify`
4. Any tampering breaks the chain — the hash won't match

### Storage

Audit entries are appended to `.dojops/history/audit.jsonl` (one JSON object per line, append-only).

---

## Execution Locking

PID-based lock files prevent concurrent mutations:

- Lock file: `.dojops/lock.json` containing `{ pid, command, timestamp }`
- Before `apply`, `destroy`, or `rollback`, the executor checks for an existing lock
- If a lock exists and the PID is alive, the operation is blocked (exit code 4)
- If the PID is dead (stale lock), the lock is automatically cleaned up
- The lock is released after the operation completes (success or failure)

---

## Timeout

The `withTimeout()` utility wraps execution with a configurable timeout:

- Default: 30 seconds (`timeoutMs` in `ExecutionPolicy`)
- On timeout, the operation is aborted and logged as a failure
- Prevents runaway LLM calls or hung external tool invocations

---

## Usage

### CLI

```bash
# Execute with default policy (interactive approval)
dojops apply

# Execute with verification
dojops apply --verify

# Execute with auto-approval
dojops apply --yes

# Dry run (auto-deny, no writes)
dojops apply --dry-run

# Resume failed tasks
dojops apply --resume
```

### Programmatic

```typescript
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";

const executor = new SafeExecutor(tool, policy, new AutoApproveHandler());
const result = await executor.run(input);
```
