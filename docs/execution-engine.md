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
backup() ------ Creates .bak copy of existing files before overwriting (when updating)
  |
  v
execute() ----- SandboxedFs writes files within policy-allowed paths
  |
  v
audit() ------- AuditEntry logged with hash chain (SHA-256)
```

---

## SafeExecutor

The `SafeExecutor` orchestrates the full pipeline. It receives:

- A `BaseSkill` instance
- An `ExecutionPolicy`
- An `ApprovalHandler`

And produces audit entries for every operation, whether successful, failed, or denied.

---

## Execution Policy

The `ExecutionPolicy` controls what the executor is allowed to do:

| Field                    | Type                   | Default   | Description                                                           |
| ------------------------ | ---------------------- | --------- | --------------------------------------------------------------------- |
| `allowWrite`             | boolean                | `false`   | Whether file writes are permitted                                     |
| `allowedPaths`           | string[]               | `[]`      | Paths the executor may write to (glob patterns)                       |
| `deniedPaths`            | string[]               | `[]`      | Paths the executor must not write to                                  |
| `envVars`                | Record<string, string> | `{}`      | Environment variables available during execution                      |
| `timeoutMs`              | number                 | `30000`   | Maximum execution time (milliseconds)                                 |
| `maxFileSize`            | number                 | `1048576` | Maximum file size in bytes (1MB default)                              |
| `skipVerification`       | boolean                | `true`    | Skip the verify step (SDK default; CLI overrides to `false`)          |
| `enforceDevOpsAllowlist` | boolean                | `true`    | When no explicit `allowedPaths`, restrict writes to DevOps files only |

### Path Resolution

1. `deniedPaths` are checked first — any match blocks the write unconditionally
2. If explicit `allowedPaths` are configured, the file must match at least one
3. If no `allowedPaths` and `enforceDevOpsAllowlist` is `true`, the file must match the DevOps write allowlist (see below)

### DevOps Write Allowlist

When `enforceDevOpsAllowlist` is enabled (the default) and no explicit `allowedWritePaths` are set, only DevOps-related files can be written. This prevents the LLM from mutating arbitrary repository files (e.g., `src/index.ts`, `package.json`).

Allowed patterns:

```
.github/workflows/**    .gitlab-ci.yml       Jenkinsfile
Dockerfile              Dockerfile.*         docker-compose*.yml
docker-compose*.yaml    helm/**              k8s/**
kubernetes/**           manifests/**         *.tf
*.tfvars                ansible/**           playbook*.yml
playbook*.yaml          nginx/**             nginx.conf
prometheus/**           alertmanager/**      Makefile
makefile                systemd/**           *.service
*.timer
```

Override with `--allow-all-paths` on the `apply` command to bypass the allowlist for advanced use cases.

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

## Backup on Update

When a tool updates an existing config file (detected via `isUpdate` flag in the generate result), `execute()` creates a `.bak` backup before writing:

- Uses `backupFile()` from `@dojops/sdk`
- Example: `main.tf` → `main.tf.bak`, `ci.yml` → `ci.yml.bak`
- Backups are only created when updating, not when creating new files
- Best-effort — backup failures don't block execution

---

## Sandboxed Filesystem

`SandboxedFs` wraps Node.js `fs` operations with policy enforcement:

- **Path restriction** — Only writes to paths allowed by the `ExecutionPolicy`
- **Size limits** — Rejects files exceeding `maxFileSize`
- **Per-file audit** — Each file operation is logged with path, size, and timestamp
- **Atomic writes** — Files are written via temp-file + `fs.renameSync` (POSIX atomic rename) to prevent partial writes on crash or failure

---

## Verification Pipeline

Tools that implement `verify()` can validate their generated output with external tools:

| Tool           | Verifier       | Command                                     |
| -------------- | -------------- | ------------------------------------------- |
| Terraform      | `terraform`    | `terraform validate` in a temp directory    |
| Dockerfile     | `hadolint`     | `hadolint Dockerfile`                       |
| Kubernetes     | `kubectl`      | `kubectl --dry-run=client -f manifest.yaml` |
| GitHub Actions | Structure lint | YAML structure validation (built-in)        |
| GitLab CI      | Structure lint | YAML structure validation (built-in)        |

### Verification Behavior

1. **Default on** — Verification runs by default in CLI commands (`apply`, `plan --execute`). Use `--skip-verify` to disable. The SDK default (`DEFAULT_POLICY.skipVerification = true`) remains unchanged for programmatic callers
2. **Tool check** — If the tool doesn't implement `verify()`, the step is skipped
3. **Binary check** — If the external binary isn't installed, verification is skipped with a warning
4. **Blocking** — Failed verification blocks execution (returns `VerificationResult.valid=false`)
5. **Logged** — Verification results are included in the audit entry

---

## Audit Trail

Every operation produces an `ExecutionAuditEntry`:

```typescript
interface ExecutionAuditEntry {
  seq: number; // Sequential entry number
  timestamp: string; // ISO 8601
  command: string; // "generate" | "apply" | "scan" | etc.
  tool?: string; // Tool name if applicable
  status: "success" | "failure" | "cancelled";
  details: Record<string, unknown>;
  filesWritten?: string[]; // Files created during execution
  filesModified?: string[]; // Pre-existing files that were overwritten (have .bak backups)
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

Audit entries are appended to `.dojops/history/audit.jsonl` (one JSON object per line, append-only). The JSONL format is directly compatible with SIEM ingestion tools (Splunk, ELK, Datadog) for enterprise audit integration.

---

## Git Dirty Working Tree Check

Before executing a plan, `apply` checks for uncommitted changes in the git working tree:

- Runs `git status --porcelain` with a 5-second timeout
- If uncommitted changes exist and `--force` is not set: displays the modified files and prompts the user to continue
- If `--yes` is set: warns but proceeds automatically
- If the directory is not a git repo or `git` is not available: silently skips the check
- The check runs after lock acquisition but before any tool execution

```bash
dojops apply                # warns if dirty tree, prompts to continue
dojops apply --force        # skips the git dirty check entirely
dojops apply --yes          # warns but auto-continues
```

---

## Rollback

`dojops rollback <plan-id>` reverses an applied plan by performing two operations:

1. **Delete created files** — Removes files listed in `filesWritten` that were newly created (not updates)
2. **Restore .bak backups** — For files listed in `filesModified` (pre-existing files that were overwritten), restores from the `.bak` backup

The `--dry-run` flag previews what would be deleted and restored without making changes.

```bash
dojops rollback <plan-id>            # interactive confirmation
dojops rollback <plan-id> --dry-run  # preview only
dojops rollback <plan-id> --yes      # auto-confirm
```

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

## Drift Awareness Warnings

Before executing a plan, `apply` displays informational warnings for tools that manage remote state. These remind users that local config validation does not guarantee the remote infrastructure matches:

| Tool       | Warning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| Terraform  | Remote state not inspected. Run `terraform plan` to check for drift.   |
| Kubernetes | Cluster state not inspected. Run `kubectl diff` to check for drift.    |
| Helm       | Release state not inspected. Run `helm diff` to check for drift.       |
| Ansible    | Host state not inspected. Run `ansible --check` to verify convergence. |

These warnings are non-blocking and informational only. They appear in the pre-flight summary before execution begins.

---

## Change Impact Summary

Before execution, `apply` displays a concise impact summary:

```
Impact Summary:
  Files to create:  ~3
  Files to modify:  ~2
  Verification:     terraform validate, hadolint, github-actions-lint
  Risk level:       MEDIUM
```

- **Files to create/modify** — Estimated from the plan's task descriptions
- **Verification** — Lists which verification tools will run for the plan's tasks
- **Risk level** — From the plan's risk classification (see Plan Risk Classification below)

---

## Plan Risk Classification

Plans are automatically classified into risk levels based on their content:

| Level    | Criteria                                                             | Behavior                                         |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `LOW`    | CI/CD tools (GitHub Actions, GitLab CI, Makefile, Prometheus)        | Normal approval flow                             |
| `MEDIUM` | Infrastructure tools (Terraform, Dockerfile, Kubernetes, Helm, etc.) | Normal approval flow                             |
| `HIGH`   | Keywords: IAM, security group, production, secret, credential, RBAC  | Requires explicit confirmation even with `--yes` |

HIGH risk plans always prompt for confirmation unless `--force` is also passed.

Additionally, `.dops` skills can self-declare their risk level via the `risk` frontmatter section (`LOW`, `MEDIUM`, or `HIGH` with a rationale string). This metadata is exposed in `DopsRuntime.metadata.riskLevel` and complements the keyword-based classifier — providing skill-level risk classification alongside plan-level classification.

---

## Usage

### CLI

```bash
# Execute with default policy (interactive approval, verification enabled)
dojops apply

# Skip verification (verification runs by default)
dojops apply --skip-verify

# Execute with auto-approval
dojops apply --yes

# Skip git dirty working tree check
dojops apply --force

# Bypass DevOps file write allowlist (allow writes to any path)
dojops apply --allow-all-paths

# Dry run (auto-deny, no writes)
dojops apply --dry-run

# Resume failed tasks
dojops apply --resume

# Deterministic replay: force temp=0, validate provider/model/prompt match
dojops apply --replay
dojops apply --replay --yes     # force despite environment mismatches
```

### Programmatic

```typescript
import { SafeExecutor, AutoApproveHandler } from "@dojops/executor";

const executor = new SafeExecutor(tool, policy, new AutoApproveHandler());
const result = await executor.run(input);
```
