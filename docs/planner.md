# Task Planner

The `@dojops/planner` package transforms complex DevOps goals into structured, dependency-aware task graphs that are executed in topological order with failure cascading and resume support.

---

## Overview

```
User Goal: "Set up CI/CD pipeline for Node.js app with Docker and Kubernetes"
     |
     v
decompose() --- LLM decomposes goal into TaskGraph (Zod-validated)
     |
     v
TaskGraph {
  nodes: [
    { id: "1", tool: "github-actions", input: {...}, deps: [] },
    { id: "2", tool: "dockerfile",     input: {...}, deps: ["1"] },
    { id: "3", tool: "kubernetes",     input: {...}, deps: ["2"] }
  ]
}
     |
     v
PlannerExecutor --- Topological sort (Kahn's algorithm) -> execute in order
     |
     v
Per-task results with $ref:<taskId> input wiring
```

---

## Goal Decomposition

The `decompose()` function sends the user's goal to the LLM with a structured Zod schema:

1. **Prompt construction** — The goal is wrapped in a system prompt that instructs the LLM to break it into tool-specific tasks with dependency ordering. The context includes a note that tools automatically detect and read existing config files, so the planner only needs to set the correct `projectPath`/`outputPath`
2. **Structured output** — The response is validated against the `TaskGraphSchema`
3. **Schema validation** — Each task node's `tool` field must match a known tool name, and `deps` must reference valid task IDs

### TaskGraph Schema

```typescript
interface TaskGraph {
  nodes: TaskNode[];
}

interface TaskNode {
  id: string; // Unique task identifier (e.g. "1", "2")
  tool: string; // Tool name (e.g. "github-actions", "terraform")
  description: string; // Human-readable task description
  input: object; // Tool-specific input (validated by tool's inputSchema)
  deps: string[]; // Task IDs this task depends on
}
```

---

## Topological Execution

The `PlannerExecutor` uses Kahn's algorithm to determine execution order:

1. **Build dependency graph** — Count in-degrees for each node
2. **Initialize queue** — Start with nodes that have zero dependencies (no `deps`)
3. **Process queue** — Execute each task, then reduce the in-degree of its dependents
4. **Failure cascading** — If a task fails, all downstream tasks (those that depend on it, transitively) are skipped

### Execution Order Example

Given tasks with dependencies:

```
Task 1 (github-actions) -> no deps
Task 2 (dockerfile)     -> depends on [1]
Task 3 (kubernetes)     -> depends on [2]
Task 4 (nginx)          -> depends on [1]
```

Execution order: `1 -> (2, 4) -> 3`

- Task 1 runs first (no dependencies)
- Tasks 2 and 4 can run in parallel (both depend only on 1)
- Task 3 runs last (depends on 2)

---

## Input Wiring

Tasks can reference outputs from completed tasks using `$ref:<taskId>`:

```json
{
  "id": "2",
  "tool": "kubernetes",
  "input": {
    "image": "$ref:1",
    "deployment": "nginx"
  },
  "deps": ["1"]
}
```

When task 2 executes, `$ref:1` is replaced with the actual output from task 1. This enables data flow between tasks in the graph.

---

## Failure Cascading

When a task fails:

1. The task is marked as failed in the execution results
2. All downstream tasks (direct and transitive dependents) are skipped
3. Independent tasks (no dependency path to the failed task) continue executing
4. The overall plan is marked as partially failed

Example:

```
Task 1 -> OK
Task 2 (depends on 1) -> FAILED
Task 3 (depends on 2) -> SKIPPED (cascaded)
Task 4 (depends on 1) -> OK (independent of 2)
```

---

## Resume

Plans can be resumed after partial failures using `completedTaskIds`:

```bash
dojops apply --resume
```

1. The executor loads the saved plan from `.dojops/plans/`
2. Previously completed tasks are identified from execution logs
3. Completed tasks are skipped (their outputs are loaded from cache)
4. Failed and pending tasks are re-executed
5. `$ref` wiring uses cached outputs for completed task references

This avoids re-running expensive LLM calls for tasks that already succeeded.

---

## Plan Persistence

Plans are saved to `.dojops/plans/<plan-id>.json` containing:

- The full `TaskGraph`
- Metadata (goal, timestamp, provider, model, temperature)
- Custom skill metadata per task (`toolType`, `toolVersion`, `toolHash`, `toolSource`, `systemPromptHash`)
- Execution context snapshot (`dojopsVersion`, `policySnapshot`, `toolVersions`)
- Risk classification (`LOW`, `MEDIUM`, or `HIGH`)
- Execution state (per-task status, outputs)

### Risk Classification

Plans are automatically assigned a risk level based on their content:

| Level    | Criteria                                                                  |
| -------- | ------------------------------------------------------------------------- |
| `LOW`    | CI/CD and monitoring tools only                                           |
| `MEDIUM` | Infrastructure tools (Terraform, Dockerfile, Kubernetes, Helm, etc.)      |
| `HIGH`   | Keywords: IAM, security group, production, secret, credential, RBAC, etc. |

HIGH risk plans always require explicit user confirmation during `apply`, even with `--yes`.

### Execution Context Snapshot

At plan creation, the following context is captured:

- **`dojopsVersion`** — Current DojOps version from `package.json`
- **`policySnapshot`** — SHA-256 hash of the execution policy
- **`toolVersions`** — Version metadata for each tool used in the plan

This snapshot enables drift detection: if the DojOps version or policy changes between plan creation and execution, `apply` shows a warning (or blocks in `--replay` mode).

### Plan Lifecycle

```bash
# Create a plan
dojops plan "Set up CI/CD for Node.js"

# Inspect the plan
dojops history show <plan-id>

# Validate the plan
dojops validate <plan-id>

# Explain the plan in plain language
dojops explain <plan-id>

# Execute the plan
dojops apply <plan-id>

# Resume after failure
dojops apply --resume

# Remove generated artifacts
dojops destroy <plan-id>

# Reverse applied changes
dojops rollback <plan-id>
```

---

## CLI Usage

```bash
# Decompose a goal into tasks
dojops plan "Create CI/CD pipeline for a Python app"

# Plan and execute immediately
dojops plan --execute "Set up monitoring with Prometheus"

# Plan, execute, and auto-approve
dojops plan --execute --yes "Create Kubernetes deployment"
```

---

## API Usage

```bash
# Create a plan
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"goal": "Set up CI/CD for Node.js", "execute": false}'

# Create and execute
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"goal": "Set up CI/CD for Node.js", "execute": true, "autoApprove": true}'
```
