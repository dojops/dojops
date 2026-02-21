Perfect.

Now we move from:

> “Powerful CLI tool”

To:

> “DevOps Intelligence Platform”

What follows is a **formal blueprint** — structured like something you would hand to investors or senior engineers.

---

# 1️⃣ Formal CLI Grammar Spec (Enterprise-Grade Contract)

This defines **how ODA behaves forever**.
Consistency = credibility.

---

## 🧠 Design Principles

1. Verb–Noun structure (like kubectl)
2. Plan → Apply separation (like Terraform)
3. Human-first defaults (like GitHub CLI)
4. Safe-by-default
5. Machine-parsable output mode

---

## 🔷 Top-Level Grammar

```bnf
oda <global-options> <command> <resource> <subcommand> [arguments] [flags]
```

---

## 🔹 Global Options (Always Available)

```bash
--profile <name>
--provider <anthropic|openai|local>
--model <model-name>
--output <table|json|yaml>
--non-interactive
--verbose
--debug
--quiet
--no-color
```

---

## 🔹 Command Families

### 1️⃣ Lifecycle Commands

```bash
oda plan <goal>
oda apply [plan-id]
oda destroy <plan-id>
oda validate [plan-id]
oda rollback <plan-id>
```

---

### 2️⃣ Resource-Oriented Commands

```bash
oda get plans
oda get agents
oda get sessions
oda get policies
```

```bash
oda describe plan <id>
oda delete plan <id>
```

---

### 3️⃣ Generation Commands

```bash
oda generate ci
oda generate terraform
oda generate docker
oda generate helm
```

Optional:

```bash
--framework node
--cloud aws
--region eu-west-1
```

---

### 4️⃣ Intelligence Commands

```bash
oda explain <plan-id|last>
oda analyze diff
oda analyze cost
oda analyze security
oda debug ci
```

---

### 5️⃣ System Commands

```bash
oda init
oda config
oda auth
oda doctor
oda serve
```

---

## 🔹 Output Contract

Enterprise mode requires machine compatibility.

```bash
oda plan "Setup CI" --output json
```

Must return structured JSON:

```json
{
  "planId": "123",
  "riskLevel": "LOW",
  "changes": {
    "add": 1,
    "modify": 0,
    "delete": 0
  }
}
```

This allows CI/CD integration.

---

# 2️⃣ Enterprise Folder Architecture

ODA must separate:

- User config
- Project config
- Cache
- Audit
- Policy
- Secrets

---

## 📁 Global User Directory

```plaintext
~/.oda/
  config.yaml
  profiles/
  tokens/
  logs/
  plugins/
  cache/
  policy/
```

---

## 📁 Project-Level Directory

```plaintext
project-root/
  .oda/
    session.json
    plans/
    history/
    state.json
    approvals/
    artifacts/
    execution-logs/
```

---

## 📁 Enterprise Mode Extension

```plaintext
.oda/
  team/
    members.json
    roles.json
    permissions.json
  audit/
    audit.log
    security-events.log
  environments/
    staging.yaml
    production.yaml
  policies/
    security.rego
    cost.rego
```

This enables governance.

---

# 3️⃣ State Management Model

This is where ODA becomes serious.

---

## 🧠 State Layers

ODA should maintain 3 layers of state:

---

### 1️⃣ Session State (Ephemeral)

```json
{
  "currentPlan": "plan-123",
  "mode": "PLAN",
  "lastAgent": "ci-specialist",
  "riskLevel": "LOW"
}
```

Stored in:

```plaintext
.oda/session.json
```

---

### 2️⃣ Plan State (Immutable Once Approved)

```json
{
  "id": "plan-123",
  "goal": "Setup CI",
  "createdAt": "...",
  "risk": "LOW",
  "files": [...],
  "approvalStatus": "APPROVED"
}
```

Stored in:

```plaintext
.oda/plans/plan-123.json
```

---

### 3️⃣ Execution State

Tracks:

- Status
- Start time
- End time
- Rollback reference
- Logs

```json
{
  "planId": "123",
  "status": "SUCCESS",
  "rollbackAvailable": true
}
```

Stored in:

```plaintext
.oda/execution-logs/
```

---

## 🔐 State Rules

- Plans immutable after approval
- Execution must reference specific plan ID
- Rollback requires prior snapshot
- Every apply creates audit entry

---

# 4️⃣ Multi-User / Team Mode

Now we enter enterprise territory.

---

## 👥 Roles

```plaintext
Owner
Admin
DevOps Engineer
Developer
Viewer
Auditor
```

---

## 🔑 Permissions Matrix

| Action  | Owner | Admin | DevOps | Dev | Viewer |
| ------- | ----- | ----- | ------ | --- | ------ |
| Plan    | ✅    | ✅    | ✅     | ✅  | ❌     |
| Apply   | ✅    | ✅    | ✅     | ❌  | ❌     |
| Destroy | ✅    | ✅    | ❌     | ❌  | ❌     |
| View    | ✅    | ✅    | ✅     | ✅  | ✅     |

---

## 🧾 Team Config File

```json
{
  "teamName": "core-platform",
  "members": [
    { "id": "u1", "role": "Owner" },
    { "id": "u2", "role": "DevOps Engineer" }
  ]
}
```

---

## 🔄 Approval Workflow

Enterprise mode:

```bash
oda apply plan-123
```

If policy requires approval:

```plaintext
Approval required from:
  - Owner
  - Security Officer
```

Apply only executes after quorum reached.

---

## 🧠 Audit Trail

Every action logged:

```plaintext
[2026-02-21] user:hedi role:DevOps plan:123 action:APPLY status:SUCCESS
```

Auditors can run:

```bash
oda audit list
```
