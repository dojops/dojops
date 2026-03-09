# DojOps Documentation

Welcome to the **DojOps — AI DevOps Automation Engine** documentation. DojOps is an enterprise-grade AI DevOps automation system that generates, validates, and executes infrastructure and CI/CD configurations using LLM providers — with structured output enforcement, sandboxed execution, approval workflows, and hash-chained audit trails.

---

## Quick Links

- **[Getting Started](getting-started.md)** — Installation, setup, and your first generation
- **[CLI Reference](cli-reference.md)** — Complete command reference with examples
- **[API Reference](api-reference.md)** — All 19 REST endpoints with schemas and curl examples

---

## Documentation Index

### Core Guides

| Document                                      | Description                                                          |
| --------------------------------------------- | -------------------------------------------------------------------- |
| [Getting Started](getting-started.md)         | Prerequisites, installation, provider setup, first run               |
| [Provider Management](provider-management.md) | Add, remove, switch, and list LLM providers                          |
| [Configuration](configuration.md)             | Providers, models, env vars, profiles, precedence                    |
| [CLI Reference](cli-reference.md)             | All commands, flags, exit codes, examples                            |
| [API Reference](api-reference.md)             | REST endpoints, request/response schemas, curl examples              |
| [Web Dashboard](dashboard.md)                 | 5-tab metrics dashboard — Overview, Security, Audit, Agents, History |

### Architecture & Design

| Document                            | Description                                                 |
| ----------------------------------- | ----------------------------------------------------------- |
| [Architecture](architecture.md)     | System design, package layers, dependency flow, data flow   |
| [Security Model](security-model.md) | Defense-in-depth layers, trust boundary, concurrency safety |

### Components

| Document                                  | Description                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [Specialist Agents](agents.md)            | 17 built-in + custom agents — routing, domains, keywords, confidence scoring, custom agent creation        |
| [DevOps Tools](tools.md)                  | All 13 built-in tools + custom tool system — schemas, detectors, verifiers, auto-detection, tool manifests |
| [Tool Specification v1](TOOL_SPEC_v1.md)  | Frozen v1 custom tool contract — manifest schema, discovery, security, compatibility promise               |
| [Security Scanning](security-scanning.md) | 10 scanners, scan types, remediation, SBOM, license compliance, scan comparison, dashboard integration     |
| [Execution Engine](execution-engine.md)   | SafeExecutor, policies, approval workflows, sandboxed fs, audit trail                                      |
| [Task Planner](planner.md)                | Goal decomposition, task graphs, topological execution, resume                                             |

### Operations

| Document                              | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| [Contributing](contributing.md)       | Dev setup, coding standards, testing, adding tools/agents, PR workflow |
| [Troubleshooting](troubleshooting.md) | Common issues, FAQ, error codes, debugging tips                        |

---

## Privacy & Telemetry

DojOps does not collect telemetry. No project data leaves your machine except to your configured LLM provider. All generated configs, audit logs, and scan reports are stored locally in your `.dojops/` directory.
