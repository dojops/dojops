# Web Dashboard

DojOps includes a web dashboard with a dark industrial terminal aesthetic for monitoring metrics, browsing agents, and reviewing execution history. Start it with `dojops serve`.

---

## Starting the Dashboard

```bash
dojops serve                    # http://localhost:3000
dojops serve --port=8080        # Custom port
dojops serve credentials        # Generate API key for authentication
```

The serve command:

1. Resolves provider configuration (CLI flags > env vars > config file)
2. Loads API key from `DOJOPS_API_KEY` env var or `~/.dojops/server.json`
3. Creates all required dependencies (provider, tools, router, debugger, diff analyzer)
4. Detects project root for metrics (`.dojops/` directory)
5. Starts the Express server with the web dashboard

---

## Tab Overview

The dashboard has 5 tabs organized in a sidebar:

| Tab      | Category   | Auto-Refresh | Description                                                    |
| -------- | ---------- | ------------ | -------------------------------------------------------------- |
| Overview | Metrics    | 30s          | Plan/execution/scan aggregates and activity timeline           |
| Security | Metrics    | 30s          | Scan findings, severity trends, category breakdown             |
| Audit    | Metrics    | 30s          | Hash chain integrity, command distribution, timeline           |
| Agents   | Operations | --           | Browse and search all 32 specialist agents (built-in + custom) |
| History  | Operations | --           | Execution history with type filtering                          |

A visual divider separates the metrics tabs (Overview, Security, Audit) from the operational tabs (Agents, History).

---

## Authentication

When the server has an API key configured (via `dojops serve credentials` or `DOJOPS_API_KEY` env var), the dashboard requires authentication:

1. **Login overlay** — On first load, the dashboard fetches `/api/health` to check the `authRequired` field. If `true` and no stored key exists, a login overlay is displayed
2. **API key input** — The overlay prompts for the API key with a hint to run `dojops serve credentials`
3. **Key validation** — On submit, the key is tested against `/api/agents`. If successful, it's stored in `sessionStorage`
4. **Auth headers** — All subsequent API calls include the `X-API-Key` header automatically
5. **401/403 handling** — If any API call returns 401 or 403, the stored key is cleared and the login overlay reappears
6. **Logout** — A logout button appears in the sidebar footer when auth is active. Clicking it clears the session and shows the login overlay

Without a configured API key, the dashboard works without authentication (local access only).

---

## Tabs

### Overview

The overview tab displays aggregated metrics:

- **Health banner** — Provider status and connectivity
- **Stat cards** — Total plans, success rate, total executions, critical/high findings
- **Most used commands** — Distribution of CLI/API commands
- **Recent activity timeline** — Chronological list of recent operations

Data source: `.dojops/plans/`, `.dojops/execution-logs/`, `.dojops/scan-history/`

### Security

The security tab provides visibility into scan findings:

- **Severity breakdown** — Bar chart of CRITICAL/HIGH/MEDIUM/LOW findings
- **Category distribution** — SECURITY, DEPENDENCY, IAC, SECRETS
- **Findings table** — Paginated list of findings with severity, tool, message, file/line
- **Scan history** — Timeline of past scans with summary stats
- **Top recurring issues** — Most frequently appearing findings

Data source: `.dojops/scan-history/*.json`

### Audit

The audit tab shows the hash-chained audit trail:

- **Integrity badge** — Shows whether the hash chain is valid (verified end-to-end)
- **Status breakdown** — success/failure/cancelled counts
- **Command distribution** — Which commands generated audit entries
- **Hash chain entries** — Individual entries with seq, timestamp, command, status, hash

Data source: `.dojops/history/audit.jsonl`

### Agents

The agents tab lets you browse all specialist agents (built-in + custom):

- **Search** — Live search by agent name or keyword
- **Domain filters** — Click domain chips to filter agents by category
- **Agent cards** — Each card shows name, domain, description, keywords, and type (built-in or custom)

No auto-refresh — agent data is static.

### History

The history tab shows execution history:

- **Type filter** — Dropdown to filter by operation type (All, Generate, Plan, Debug CI, Diff)
- **Clear button** — Delete all history entries
- **Entry list** — Each entry shows operation type, timestamp, and status
- **Detail expansion** — Click an entry to see full details (input, output, agent used)

---

## Features

### Auto-Refresh

The metrics tabs (Overview, Security, Audit) automatically refresh every 30 seconds. An indicator is shown on these tabs.

### Provider Status

The sidebar footer shows the connected LLM provider with a status badge. Mobile view shows this in the header.

### Design

- **Theme** — Dark industrial terminal aesthetic
- **Fonts** — JetBrains Mono (code) + Outfit (headings) from Google Fonts
- **Background** — Decorative grid with glow layers
- **Responsive** — Mobile-friendly with hamburger menu and overlay navigation
- **Notifications** — Toast notification container for success/error messages

---

## Metrics Data

The dashboard pulls metrics from the `MetricsAggregator`, which reads `.dojops/` project data on-demand:

| Metric Type | Data Sources                                                         | Endpoint                    |
| ----------- | -------------------------------------------------------------------- | --------------------------- |
| Overview    | `.dojops/plans/`, `.dojops/execution-logs/`, `.dojops/scan-history/` | `GET /api/metrics/overview` |
| Security    | `.dojops/scan-history/*.json`                                        | `GET /api/metrics/security` |
| Audit       | `.dojops/history/audit.jsonl`                                        | `GET /api/metrics/audit`    |

Metrics are disabled if no `.dojops/` project directory is found. The dashboard gracefully shows empty states in this case.

---

## Requirements

- The dashboard requires a running LLM provider for generation features
- Metrics tabs require `dojops init` to have been run (creates `.dojops/` directory)
- Authentication is optional — required only when an API key is configured via `dojops serve credentials` or `DOJOPS_API_KEY` env var
