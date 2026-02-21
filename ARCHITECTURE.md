# ODA Architecture

## Overview

ODA is designed as a modular, layered DevOps agent system.

It is NOT a simple chatbot that generates bash commands.

It is a structured, safe, extensible orchestration framework.

---

## High-Level Architecture

User
↓
CLI / API
↓
Planner Engine
↓
Agent Core (LLM Abstraction)
↓
Tool SDK Layer
↓
Execution Engine (Sandboxed)

---

## Core Layers

### 1. LLM Layer

Provides abstraction over:

- OpenAI
- Anthropic
- Ollama

Each provider implements:

interface LLMProvider {
generate(request): Promise<Response>
}

---

### 2. Planner Engine

Transforms user intent into structured task graphs.

Example:

Input:
"Create a GitHub workflow for Node app"

Output:
[
{ task: "detect_language" },
{ task: "generate_dockerfile" },
{ task: "generate_workflow_yaml" }
]

---

### 3. Tool SDK

Each DevOps tool implements:

interface DevOpsTool {
validate(input)
generate(input)
execute(input)
}

This ensures:

- Deterministic behavior
- Input validation
- Controlled execution

---

### 4. Execution Engine

Responsible for:

- Running Terraform plan
- Executing Ansible
- Applying Kubernetes manifests
- Sandbox isolation
- Preventing unsafe operations

---

## Design Principles

1. No blind execution.
2. Structured JSON outputs from LLM.
3. Schema validation before tool execution.
4. Idempotent infrastructure operations.
5. Clear separation of concerns.
6. Extensibility via plugin architecture.

---

## Security Architecture

ODA implements defense-in-depth with six layers between LLM output and infrastructure changes:

```
  LLM Response
       │
  ┌────▼────┐
  │Structured│  Provider-native JSON mode (OpenAI response_format,
  │ Output   │  Anthropic prefill, Ollama format)
  └────┬─────┘
       │
  ┌────▼────┐
  │  Input   │  Zod schema validation on every tool input
  │Validation│  and LLM response (parseAndValidate)
  └────┬─────┘
       │
  ┌────▼────┐
  │ Policy   │  ExecutionPolicy: allowWrite, allowedPaths,
  │ Engine   │  deniedPaths, envVars, timeoutMs, maxFileSize
  └────┬─────┘
       │
  ┌────▼────┐
  │Approval  │  ApprovalHandler: auto-approve, auto-deny,
  │Workflow  │  or interactive callback with diff preview
  └────┬─────┘
       │
  ┌────▼────┐
  │Sandboxed │  SandboxedFs: path-restricted file operations
  │Execution │  with per-file audit logging
  └────┬─────┘
       │
  ┌────▼────┐
  │Immutable │  Hash-chained JSONL audit trail (SHA-256)
  │Audit Log │  with tamper detection via `oda history verify`
  └──────────┘
```

**Trust boundary**: LLM output is untrusted. All data crosses the trust boundary at the Structured Output layer and is validated at every subsequent layer before any write operation occurs.

**Concurrency safety**: PID-based execution locking (`lock.json`) prevents concurrent apply/destroy/rollback operations, with automatic stale-lock cleanup for dead processes.

---

## Future Expansion

- Multi-agent architecture
- Policy engine
- Cost estimation engine
- Drift detection
- Infra diff intelligence
- Cloud provider integrations
