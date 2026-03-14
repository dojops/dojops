# API Reference

DojOps exposes a REST API via Express with 21 endpoints covering generation, planning, autonomous agent, diagnostics, scanning, chat, metrics, and history. Start the server with `dojops serve`.

---

## Base URL

```
http://localhost:3000/api       # Backward-compatible (no version prefix)
http://localhost:3000/api/v1    # Versioned (includes X-API-Version: 1 header)
```

Both prefixes route to the same handlers. The `/api/v1/` prefix sets the `X-API-Version: 1` response header for clients that need explicit version negotiation. The port is configurable via `--port` flag or `DOJOPS_API_PORT` environment variable.

---

## Authentication

The API supports optional API key authentication via `Bearer` token or `X-API-Key` header:

```bash
# Bearer token
curl -H "Authorization: Bearer <your-api-key>" http://localhost:3000/api/agents

# X-API-Key header
curl -H "X-API-Key: <your-api-key>" http://localhost:3000/api/agents
```

**Generating credentials:**

```bash
dojops serve credentials   # Generates API key, saves to ~/.dojops/server.json
```

When an API key is configured (via `DOJOPS_API_KEY` env var or `~/.dojops/server.json`), all endpoints except the minimal `GET /api/health` response require authentication. Without a configured API key, all endpoints are accessible without credentials.

Key comparison uses `crypto.timingSafeEqual` to prevent timing attacks.

---

## Endpoints

### Health

#### `GET /api/health`

Returns server status and auth requirement. When authenticated (or when auth is disabled), returns full diagnostic payload.

**Response (unauthenticated, auth enabled):**

```json
{
  "status": "ok",
  "authRequired": true,
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

**Response (authenticated or auth disabled):**

```json
{
  "status": "ok",
  "authRequired": false,
  "provider": "openai",
  "tools": ["github-actions", "terraform", "kubernetes", ...],
  "metricsEnabled": true,
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

The `authRequired` field indicates whether the server has API key authentication configured. When `authRequired` is `true`, unauthenticated callers receive only the minimal payload (status, authRequired, timestamp) to prevent information leakage.

---

### Generation

#### `POST /api/generate`

Agent-routed LLM generation. DojOps routes the prompt to the most relevant specialist agent.

**Request:**

```json
{
  "prompt": "Create a Kubernetes deployment for nginx",
  "temperature": 0.7
}
```

| Field         | Type   | Required | Description             |
| ------------- | ------ | -------- | ----------------------- |
| `prompt`      | string | Yes      | Natural language prompt |
| `temperature` | number | No       | LLM temperature (0-1)   |

**Response:**

```json
{
  "content": "apiVersion: apps/v1\nkind: Deployment\n...",
  "agent": {
    "name": "kubernetes-specialist",
    "domain": "container-orchestration",
    "confidence": 0.92,
    "reason": "Matched keywords: kubernetes, deployment, nginx"
  },
  "historyId": "gen-a1b2c3d4"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a Kubernetes deployment for nginx", "temperature": 0.7}'
```

---

### Planning

#### `POST /api/plan`

Decompose a goal into a dependency-aware task graph with optional execution.

**Request:**

```json
{
  "goal": "Set up CI/CD for a Node.js app",
  "execute": false,
  "autoApprove": false
}
```

| Field         | Type    | Required | Description                             |
| ------------- | ------- | -------- | --------------------------------------- |
| `goal`        | string  | Yes      | Goal to decompose                       |
| `execute`     | boolean | No       | Execute after planning (default: false) |
| `autoApprove` | boolean | No       | Auto-approve execution (default: false) |

**Response:**

```json
{
  "graph": {
    "nodes": [
      { "id": "1", "tool": "github-actions", "input": {...}, "deps": [] },
      { "id": "2", "tool": "dockerfile", "input": {...}, "deps": ["1"] }
    ]
  },
  "result": null,
  "historyId": "plan-e5f6g7h8"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"goal": "Set up CI/CD for a Node.js app", "execute": false}'
```

---

### Autonomous Agent

#### `POST /api/auto`

Run the autonomous agent loop (ReAct pattern). The agent iteratively reads files, makes changes, runs commands, and verifies until the task is complete.

**Request:**

```json
{
  "prompt": "Add health check endpoint to the Express API",
  "maxIterations": 20,
  "allowAllPaths": false
}
```

| Field           | Type    | Required | Description                             |
| --------------- | ------- | -------- | --------------------------------------- |
| `prompt`        | string  | Yes      | Task description                        |
| `maxIterations` | number  | No       | Max agent loop iterations (default: 20) |
| `allowAllPaths` | boolean | No       | Bypass write path restrictions          |

**Response:**

```json
{
  "success": true,
  "summary": "Added GET /health endpoint with database connectivity check",
  "iterations": 5,
  "totalTokens": 12500,
  "toolCalls": [
    { "name": "read_file", "arguments": { "path": "src/app.ts" } },
    {
      "name": "edit_file",
      "arguments": { "path": "src/app.ts", "old_string": "...", "new_string": "..." }
    },
    { "name": "run_command", "arguments": { "command": "npm test" } },
    { "name": "done", "arguments": { "summary": "Added health check endpoint" } }
  ],
  "filesWritten": [],
  "filesModified": ["src/app.ts"],
  "historyId": "auto-a1b2c3d4"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/auto \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Add health check endpoint to the Express API"}'
```

---

### Diagnostics

#### `POST /api/debug-ci`

Diagnose CI/CD log failures. Returns structured diagnosis with error type, root cause, affected files, and suggested fixes.

**Request:**

```json
{
  "log": "ERROR: npm ERR! ERESOLVE unable to resolve dependency tree"
}
```

| Field | Type   | Required | Description      |
| ----- | ------ | -------- | ---------------- |
| `log` | string | Yes      | CI/CD log output |

**Response:**

```json
{
  "diagnosis": {
    "errorType": "dependency-resolution",
    "rootCause": "Conflicting peer dependency versions",
    "affectedFiles": ["package.json"],
    "fixes": [
      {
        "description": "Use --legacy-peer-deps flag",
        "command": "npm install --legacy-peer-deps",
        "confidence": 0.85
      }
    ]
  },
  "historyId": "debug-i9j0k1l2"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/debug-ci \
  -H "Content-Type: application/json" \
  -d '{"log": "ERROR: npm ERR! ERESOLVE unable to resolve dependency tree"}'
```

#### `POST /api/diff`

Analyze infrastructure diffs for risk, cost impact, security implications, and recommendations.

**Request:**

```json
{
  "diff": "+ resource \"aws_s3_bucket\" \"main\" { bucket = \"my-bucket\" }",
  "before": "optional previous state",
  "after": "optional new state"
}
```

| Field    | Type   | Required | Description                |
| -------- | ------ | -------- | -------------------------- |
| `diff`   | string | Yes      | Infrastructure diff output |
| `before` | string | No       | Previous state context     |
| `after`  | string | No       | New state context          |

**Response:**

```json
{
  "analysis": {
    "riskLevel": "low",
    "costImpact": "minimal",
    "securityImpact": "none",
    "rollbackComplexity": "simple",
    "recommendations": ["Enable bucket versioning", "Add encryption"]
  },
  "historyId": "diff-m3n4o5p6"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/diff \
  -H "Content-Type: application/json" \
  -d '{"diff": "+ resource \"aws_s3_bucket\" \"main\" { bucket = \"my-bucket\" }"}'
```

---

### Security Scanning

#### `POST /api/scan`

Run security scanners against a project directory.

**Request:**

```json
{
  "target": "/path/to/project",
  "scanType": "all"
}
```

| Field      | Type   | Required | Description                                        |
| ---------- | ------ | -------- | -------------------------------------------------- |
| `target`   | string | No       | Project path (defaults to cwd)                     |
| `scanType` | string | No       | `all` (default), `security`, `deps`, `iac`, `sbom` |

**Response:**

```json
{
  "id": "scan-q7r8s9t0",
  "projectPath": "/path/to/project",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "scanType": "all",
  "findings": [
    {
      "id": "npm-1",
      "tool": "npm-audit",
      "severity": "HIGH",
      "category": "DEPENDENCY",
      "message": "prototype-pollution in lodash <4.17.21",
      "recommendation": "Upgrade lodash to >=4.17.21",
      "autoFixAvailable": true
    }
  ],
  "summary": {
    "total": 5,
    "critical": 0,
    "high": 2,
    "medium": 2,
    "low": 1
  },
  "scannersRun": ["npm-audit", "trivy", "gitleaks"],
  "scannersSkipped": ["pip-audit: no Python project detected"],
  "durationMs": 3200,
  "historyId": "scan-q7r8s9t0"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"scanType": "security"}'
```

---

### Chat

#### `POST /api/chat`

Send a message to a chat session. Creates a new session if `sessionId` is not provided.

**Request:**

```json
{
  "sessionId": "chat-a1b2c3d4",
  "message": "How should I set up Terraform state management?",
  "agent": "terraform-specialist"
}
```

| Field       | Type   | Required | Description                                  |
| ----------- | ------ | -------- | -------------------------------------------- |
| `message`   | string | Yes      | User message                                 |
| `sessionId` | string | No       | Existing session ID (creates new if omitted) |
| `agent`     | string | No       | Pin to a specialist agent                    |

**Response:**

```json
{
  "content": "For Terraform state management, I recommend...",
  "agent": "terraform-specialist",
  "sessionId": "chat-a1b2c3d4"
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How should I set up Terraform state management?"}'
```

#### `POST /api/chat/sessions`

Create a new chat session.

**Request:**

```json
{
  "name": "infra-planning",
  "mode": "INTERACTIVE"
}
```

| Field  | Type   | Required | Description                                |
| ------ | ------ | -------- | ------------------------------------------ |
| `name` | string | No       | Session name                               |
| `mode` | string | No       | `INTERACTIVE` (default) or `DETERMINISTIC` |

**Response (201):**

```json
{
  "id": "chat-a1b2c3d4",
  "name": "infra-planning",
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-01-15T10:30:00.000Z",
  "mode": "INTERACTIVE",
  "messages": [],
  "metadata": {
    "totalTokensEstimate": 0,
    "messageCount": 0
  }
}
```

**curl:**

```bash
curl -X POST http://localhost:3000/api/chat/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "infra-planning"}'
```

#### `GET /api/chat/sessions`

List all active chat sessions, sorted by most recently updated.

**Response:**

```json
[
  {
    "id": "chat-a1b2c3d4",
    "name": "infra-planning",
    "updatedAt": "2026-01-15T10:30:00.000Z",
    "mode": "INTERACTIVE",
    "metadata": { "messageCount": 12 }
  }
]
```

**curl:**

```bash
curl http://localhost:3000/api/chat/sessions
```

#### `GET /api/chat/sessions/:id`

Get a session's full state by ID.

**curl:**

```bash
curl http://localhost:3000/api/chat/sessions/chat-a1b2c3d4
```

#### `DELETE /api/chat/sessions/:id`

Delete a chat session.

**curl:**

```bash
curl -X DELETE http://localhost:3000/api/chat/sessions/chat-a1b2c3d4
```

---

### Agents

#### `GET /api/agents`

List all specialist agents (built-in + custom) with their domains, descriptions, keywords, and type.

**Response:**

```json
[
  {
    "name": "terraform-specialist",
    "domain": "infrastructure",
    "description": "Expert in Terraform, HCL, modules, state management...",
    "keywords": ["terraform", "infrastructure", "iac", "hcl", ...],
    "type": "built-in"
  },
  {
    "name": "sre-specialist",
    "domain": "site-reliability",
    "description": "SRE specialist for incident response and reliability",
    "keywords": ["sre", "incident", "reliability", ...],
    "type": "custom"
  }
]
```

**curl:**

```bash
curl http://localhost:3000/api/agents
```

---

### History

#### `GET /api/history`

List execution history with optional filtering.

**Query Parameters:**

| Param   | Type   | Description                                                            |
| ------- | ------ | ---------------------------------------------------------------------- |
| `type`  | string | Filter: `generate`, `plan`, `auto`, `debug-ci`, `diff`, `scan`, `chat` |
| `limit` | number | Max entries to return                                                  |

**Response:**

```json
{
  "entries": [...],
  "count": 42
}
```

**curl:**

```bash
curl "http://localhost:3000/api/history?type=generate&limit=10"
```

#### `GET /api/history/:id`

Get a single history entry by ID.

**curl:**

```bash
curl http://localhost:3000/api/history/gen-a1b2c3d4
```

#### `DELETE /api/history`

Clear all execution history.

**curl:**

```bash
curl -X DELETE http://localhost:3000/api/history
```

---

### Metrics

Metrics endpoints are only available when the server has access to a `.dojops/` project directory (auto-detected by the CLI `serve` command).

#### `GET /api/metrics`

Full dashboard metrics combining overview, security, and audit data.

**curl:**

```bash
curl http://localhost:3000/api/metrics
```

#### `GET /api/metrics/overview`

Plan, execution, and scan aggregates.

**Response:**

```json
{
  "totalPlans": 15,
  "totalExecutions": 12,
  "successRate": 0.83,
  "avgExecutionTimeMs": 4500,
  "criticalFindings": 2,
  "highFindings": 5,
  "mostUsedCommands": {"generate": 20, "plan": 15, "scan": 8},
  "recentActivity": [...]
}
```

**curl:**

```bash
curl http://localhost:3000/api/metrics/overview
```

#### `GET /api/metrics/security`

Scan findings, severity trends, and top issues.

**Response:**

```json
{
  "totalScans": 8,
  "severityBreakdown": {"critical": 2, "high": 5, "medium": 12, "low": 8},
  "categoryBreakdown": {"SECURITY": 10, "DEPENDENCY": 8, "IAC": 5, "SECRETS": 4},
  "findingsTrend": [...],
  "topIssues": [...],
  "scanHistory": [...]
}
```

**curl:**

```bash
curl http://localhost:3000/api/metrics/security
```

#### `GET /api/metrics/audit`

Audit chain integrity and command distribution.

**Response:**

```json
{
  "totalEntries": 45,
  "chainIntegrity": true,
  "statusBreakdown": {"success": 38, "failure": 5, "cancelled": 2},
  "commandDistribution": {"generate": 20, "apply": 12, "scan": 8, "plan": 5},
  "timeline": [...]
}
```

**curl:**

```bash
curl http://localhost:3000/api/metrics/audit
```

#### `GET /api/metrics/tokens`

LLM token usage tracking via `TokenTracker`.

**Response:**

```json
{
  "totalPromptTokens": 15000,
  "totalCompletionTokens": 8000,
  "totalTokens": 23000,
  "requestCount": 42
}
```

**curl:**

```bash
curl http://localhost:3000/api/metrics/tokens
```

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Validation failed",
  "details": "prompt is required"
}
```

Common HTTP status codes:

| Status | Meaning                                    |
| ------ | ------------------------------------------ |
| 200    | Success                                    |
| 201    | Created (new chat session)                 |
| 400    | Bad request (validation failed)            |
| 401    | Unauthorized (missing or invalid API key)  |
| 403    | Forbidden (e.g., autoApprove without auth) |
| 404    | Not found                                  |
| 500    | Internal server error                      |

---

## Request Validation

All POST endpoints validate request bodies against Zod schemas. Invalid requests return 400 with details:

```json
{
  "error": "Validation failed",
  "details": [{ "path": ["prompt"], "message": "Required" }]
}
```
