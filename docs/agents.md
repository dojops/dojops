# Specialist Agents

DojOps includes 32 built-in specialist agents for intelligent prompt routing, plus support for user-defined **custom agents**. Each agent is a domain expert with a tailored system prompt, keyword set, and optional tool dependencies.

---

## How Routing Works

When you send a prompt to DojOps, the `AgentRouter` scores it against each agent's keyword list:

1. **Keyword matching** — Each agent has a set of domain-specific keywords. The router counts how many keywords appear in the prompt.
2. **Confidence scoring** — The score is normalized based on keyword match density. Higher scores indicate stronger domain relevance.
3. **Threshold check** — If the highest-scoring agent exceeds the confidence threshold, the prompt is routed to that specialist.
4. **Fallback** — If no agent exceeds the threshold, the prompt goes to the general-purpose `DevOpsAgent`.

The selected agent's system prompt is prepended to the LLM request, providing domain-specific instructions and constraints.

---

## Agent List

| #   | Agent                      | Domain                  | Description                                                                                          |
| --- | -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `ops-cortex`               | orchestration           | Task decomposition, cross-domain routing, dependency ordering, strategy, roadmap, migration planning |
| 2   | `terraform-specialist`     | infrastructure          | Terraform, HCL, modules, state management, workspaces, providers, cost optimization                  |
| 3   | `kubernetes-specialist`    | container-orchestration | Deployments, Helm, RBAC, autoscaling, service mesh, ingress, operators, CRDs                         |
| 4   | `cicd-specialist`          | ci-cd                   | GitHub Actions, GitLab CI, Jenkins, build optimization, pipelines, artifacts, caching                |
| 5   | `security-auditor`         | security                | Vulnerability scanning, secret management, IAM, RBAC, CVEs, threat modeling, encryption              |
| 6   | `observability-specialist` | observability           | Prometheus, Grafana, Datadog, tracing, SLOs, SLIs, alerting, OpenTelemetry, logging                  |
| 7   | `docker-specialist`        | containerization        | Multi-stage builds, image optimization, registries, BuildKit, Compose, distroless images             |
| 8   | `cloud-architect`          | cloud-architecture      | AWS/GCP/Azure design, cost optimization, migration strategies, serverless, well-architected          |
| 9   | `network-specialist`       | networking              | DNS, load balancers, VPN, CDN, service mesh, firewall rules, VPC, subnets, proxies                   |
| 10  | `database-specialist`      | data-storage            | PostgreSQL, MySQL, Redis, DynamoDB, MongoDB, replication, backup, migration, schema design           |
| 11  | `gitops-specialist`        | gitops                  | ArgoCD, Flux, drift detection, sealed secrets, progressive delivery, reconciliation                  |
| 12  | `compliance-auditor`       | compliance              | SOC2, HIPAA, PCI-DSS, GDPR, policy-as-code (OPA/Rego), Kyverno, CIS benchmarks                       |
| 13  | `ci-debugger`              | ci-debugging            | Log analysis, root cause diagnosis, flaky test detection, error classification                       |
| 14  | `appsec-specialist`        | application-security    | OWASP Top 10, SAST/DAST, code review, pentest methodology, Snyk, Trivy, Gitleaks                     |
| 15  | `shell-specialist`         | shell-scripting         | Bash/POSIX, ShellCheck, error handling, cron, automation, sed, awk, pipefail                         |
| 16  | `python-specialist`        | python-scripting        | Type hints, pytest, Poetry, async, Flask, Django, FastAPI, mypy, ruff                                |
| 17  | `devsecops-reviewer`       | devops-review           | Config review, version validation, deprecated syntax, security audit, Context7 docs                  |
| 18  | `sre-specialist`           | site-reliability        | SLOs, SLIs, error budgets, incident management, capacity planning, toil reduction                    |
| 19  | `cost-optimizer`           | cost-optimization       | Cloud cost analysis, right-sizing, FinOps, reserved instances, spot strategies                       |
| 20  | `incident-response`        | incident-management     | Incident triage, severity classification, RCA, communication plans, escalation paths                 |
| 21  | `remediation-specialist`   | remediation             | Vulnerability fixes, dependency updates, security patching, config hardening                         |
| 22  | `performance-engineer`     | performance             | Load testing, profiling, bottleneck analysis, caching strategies, benchmarking                       |
| 23  | `api-security-specialist`  | api-security            | OAuth, JWT, OWASP API Top 10, rate limiting, API gateway config, CORS                                |
| 24  | `container-security`       | container-security      | Image scanning, runtime security, Falco, seccomp, rootless containers, supply chain                  |
| 25  | `secret-management`        | secrets                 | Vault, KMS, secret rotation, External Secrets Operator, SOPS, credential lifecycle                   |
| 26  | `log-analyzer`             | log-analysis            | ELK, Loki, Fluentd, structured logging, log parsing, anomaly detection                               |
| 27  | `migration-specialist`     | migration               | Cloud migration, database migration, blue-green cutover, data pipelines                              |
| 28  | `chaos-engineer`           | chaos-engineering       | Litmus, Chaos Mesh, Gremlin, game days, failure injection, resilience testing                        |
| 29  | `platform-engineer`        | platform-engineering    | Internal developer platforms, Backstage, Crossplane, golden paths, self-service                      |
| 30  | `change-impact-analyst`    | change-analysis         | Blast radius estimation, dependency tracing, risk scoring, rollback planning                         |
| 31  | `runbook-generator`        | runbook-generation      | Operational runbooks, decision trees, escalation paths, procedure authoring                          |
| 32  | `policy-engine-specialist` | policy-as-code          | OPA, Rego, Kyverno, Gatekeeper, admission control, policy testing                                    |

---

## Keywords Reference

Each agent is matched by the following keyword sets:

| Agent                      | Keywords                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ops-cortex`               | plan, decompose, break down, steps, orchestrate, coordinate, multi-step, project, strategy, roadmap, migration plan, goal, end-to-end, full stack                               |
| `terraform-specialist`     | terraform, infrastructure, iac, hcl, provision, resource, module, state, backend, workspace, tf, provider, data source, output, variable                                        |
| `kubernetes-specialist`    | kubernetes, k8s, pod, deployment, service, helm, ingress, namespace, kubectl, statefulset, daemonset, hpa, kustomize, operator, crd                                             |
| `cicd-specialist`          | ci, cd, pipeline, github actions, build, deploy, release, continuous, jenkins, gitlab ci, artifact, workflow, cache, matrix, runner                                             |
| `security-auditor`         | security, audit, vulnerability, secret, scan, firewall, iam, rbac, cve, threat, penetration, hardening, encryption, tls, certificate                                            |
| `observability-specialist` | monitoring, logging, alerting, tracing, prometheus, grafana, datadog, observability, metrics, dashboard, slo, sli, opentelemetry, loki, elk                                     |
| `docker-specialist`        | docker, dockerfile, container, image, compose, registry, ecr, gcr, buildkit, multi-stage, distroless, alpine, buildx, layer                                                     |
| `cloud-architect`          | aws, gcp, azure, cloud, architect, serverless, lambda, s3, ec2, vpc, region, cost, well-architected, migration, landing zone, multi-cloud                                       |
| `network-specialist`       | dns, load balancer, vpn, vpc, subnet, cdn, nginx, traefik, route53, peering, proxy, network, gateway, ssl, http                                                                 |
| `database-specialist`      | database, postgres, mysql, redis, dynamodb, mongodb, rds, cache, backup, replication, migration, schema, sql, nosql, elasticsearch                                              |
| `gitops-specialist`        | gitops, argocd, flux, reconciliation, sync, promotion, drift, declarative, sealed secrets, sops, rollout, flagger, kustomization, image automation                              |
| `compliance-auditor`       | compliance, soc2, hipaa, pci, gdpr, policy, governance, regulation, opa, rego, kyverno, sentinel, cis benchmark, audit trail                                                    |
| `ci-debugger`              | debug, error, failed, failure, log, broken, fix, timeout, flaky, crash, exit code, stack trace, oom, ci error                                                                   |
| `appsec-specialist`        | appsec, owasp, xss, injection, csrf, ssrf, pentest, sast, dast, code review, secure coding, exploit, snyk, trivy, gitleaks                                                      |
| `shell-specialist`         | bash, shell, shellcheck, sh, zsh, posix, script, cron, sed, awk, grep, pipefail, trap, shebang                                                                                  |
| `python-specialist`        | python, pip, pytest, mypy, ruff, poetry, venv, asyncio, flask, django, fastapi, pep8, pylint, typer                                                                             |
| `devsecops-reviewer`       | review, check, validate, verify, audit, outdated, deprecated, version, lint, best practices, config review, devsecops, devops review, security review, upgrade, update versions |
| `sre-specialist`           | sre, reliability, slo, sli, error budget, incident, postmortem, capacity, toil, chaos, on-call, pager                                                                           |
| `cost-optimizer`           | cost, optimize, expensive, budget, finops, right-size, reserved, spot, savings, spend, billing                                                                                  |
| `incident-response`        | incident, outage, downtime, pagerduty, opsgenie, runbook, escalation, severity, rca, root cause                                                                                 |
| `remediation-specialist`   | remediate, fix, patch, update, vulnerability, cve, upgrade, harden, mitigate, resolve                                                                                           |
| `performance-engineer`     | performance, latency, throughput, load test, bottleneck, cache, optimize, slow, profile, benchmark                                                                              |
| `api-security-specialist`  | api security, oauth, jwt, oidc, rate limit, cors, api gateway, api key, authorization, authentication                                                                           |
| `container-security`       | container security, image scan, falco, seccomp, apparmor, rootless, distroless, trivy, grype, cosign, sbom                                                                      |
| `secret-management`        | vault, secret, credential, rotate, kms, seal, unseal, secrets manager, external secrets, sops                                                                                   |
| `log-analyzer`             | log, logging, elk, loki, fluentd, logstash, kibana, parse, aggregate, structured log, syslog                                                                                    |
| `migration-specialist`     | migrate, migration, lift and shift, replatform, rearchitect, cutover, blue-green migration, data migration                                                                      |
| `chaos-engineer`           | chaos, chaos engineering, litmus, chaos mesh, gremlin, game day, fault injection, resilience, blast radius                                                                      |
| `platform-engineer`        | platform, idp, backstage, crossplane, golden path, developer experience, self-service, portal, scaffold                                                                         |
| `change-impact-analyst`    | impact, blast radius, change risk, downstream, dependency, rollback plan, risk score, affected                                                                                  |
| `runbook-generator`        | runbook, procedure, playbook, standard operating, escalation, decision tree, operational guide                                                                                  |
| `policy-engine-specialist` | opa, rego, kyverno, gatekeeper, admission, policy, guardrail, constraint, enforce, conftest                                                                                     |

---

## Tool Dependencies

Some agents declare external tool dependencies that enhance their capabilities:

| Agent                      | Tool Dependency               |
| -------------------------- | ----------------------------- |
| `terraform-specialist`     | `hcl2json`                    |
| `kubernetes-specialist`    | `yaml-lint`                   |
| `cicd-specialist`          | `yaml-lint`                   |
| `security-auditor`         | `snyk`                        |
| `docker-specialist`        | `dockerfilelint`              |
| `gitops-specialist`        | `yaml-lint`                   |
| `compliance-auditor`       | `@open-policy-agent/opa-wasm` |
| `appsec-specialist`        | `snyk`                        |
| `shell-specialist`         | `shellcheck`                  |
| `python-specialist`        | `pyright`                     |
| `policy-engine-specialist` | `@open-policy-agent/opa-wasm` |

---

## Using Agents

### CLI

```bash
# List all agents
dojops agents list

# Show agent details (partial names supported)
dojops agents info terraform              # matches terraform-specialist
dojops agents info security               # matches security-auditor
dojops agents info cloud                  # matches cloud-architect
dojops agents info terraform-specialist   # exact name also works

# Pin chat to an agent
dojops chat --agent=terraform
```

### API

```bash
# List all agents
curl http://localhost:3000/api/agents
```

### Automatic Routing

Agents are selected automatically based on prompt content. No manual routing is needed:

```bash
# Routes to terraform-specialist (matches: terraform, s3, iac)
dojops "Create a Terraform config for S3"

# Routes to kubernetes-specialist (matches: kubernetes, deployment, nginx)
dojops "Write a Kubernetes deployment for nginx"

# Routes to cicd-specialist (matches: github actions, pipeline, ci)
dojops "Set up GitHub Actions CI pipeline"

# Routes to ops-cortex (matches: plan, multi-step, end-to-end)
dojops plan "Set up end-to-end CI/CD with Docker and Kubernetes"
```

---

## Custom Agents

In addition to the 32 built-in agents, you can create your own custom agents. Custom agents participate in the same keyword-based routing as built-in agents and can even override built-in agents by name.

### Agent Definition Format

Each custom agent is a directory with a structured `README.md`:

```
.dojops/agents/sre-specialist/README.md
```

```markdown
# SRE Specialist

## Domain

site-reliability

## Description

SRE specialist for incident response, reliability engineering, and observability.

## System Prompt

You are an SRE specialist. You specialize in:

- Incident response and post-mortems
- SLO/SLI design and error budgets
- Chaos engineering and resilience testing
- On-call runbooks and escalation procedures
- Capacity planning and performance optimization

When asked about infrastructure, focus on reliability patterns...

## Keywords

sre, incident, reliability, error budget, slo, chaos, postmortem, runbook, on-call, resilience
```

Required sections: `## Domain`, `## Description`, `## System Prompt`, `## Keywords` (comma-separated).

### Discovery Paths

Custom agents are discovered from two locations:

| Location | Path                                | Scope                      |
| -------- | ----------------------------------- | -------------------------- |
| Project  | `.dojops/agents/<name>/README.md`   | Current project only       |
| Global   | `~/.dojops/agents/<name>/README.md` | Shared across all projects |

Project agents override global agents with the same name.

### Creating Custom Agents

**LLM-generated** (recommended):

```bash
dojops agents create "an SRE specialist for incident response and reliability"
```

The LLM generates a complete agent definition (name, domain, description, system prompt, keywords) and writes the README.md to `.dojops/agents/<name>/`.

**Manual creation**:

```bash
dojops agents create --manual
```

Interactive prompts guide you through defining name, domain, description, system prompt, and keywords.

**Global agents** (shared across projects):

```bash
dojops agents create --global "a cost optimization specialist"
```

### Managing Custom Agents

```bash
# List all agents (built-in + custom)
dojops agents list

# Show agent details (includes source path for custom agents)
dojops agents info sre-specialist

# Remove a custom agent
dojops agents remove sre-specialist
```

### Routing with Custom Agents

Custom agents are routed exactly like built-in agents — by keyword matching. If a custom agent's keywords match the prompt with higher confidence than any built-in agent, the custom agent handles the request:

```bash
# Routes to custom sre-specialist (matches: sre, error budget, slo)
dojops "Design SLOs and error budgets for our payment service"
```

---

## Agents in Plan Execution

Beyond prompt routing, agents also participate in **plan execution**. When `dojops plan` decomposes a goal into a task graph, the LLM assigns a specialist agent to each task based on domain relevance.

During execution, the assigned agent's system prompt is injected as domain context into the skill's LLM call. This means the LLM sees both:

- **Agent expertise** — Domain-specific knowledge (e.g., Terraform state management, K8s security best practices)
- **Skill instructions** — The skill's generation format and rules (e.g., "output valid HCL")

```
Goal: "Set up CI/CD with Docker and Kubernetes"

Task 1: github-actions  [cicd-specialist]       -> CI/CD pipeline expertise
Task 2: dockerfile      [docker-specialist]     -> Multi-stage build patterns
Task 3: kubernetes      [kubernetes-specialist]  -> Deployment best practices
```

Agent assignment is optional — tasks where no specialist clearly matches proceed without additional domain context. Both built-in and custom agents participate in delegation.

See [Task Planner](planner.md) for details on the decomposition and execution flow.

---

## Built-in Agent Configuration

Built-in agents are defined in `packages/core/src/agents/specialists.ts`. Each agent specifies:

- `name` — Unique identifier
- `domain` — Category label
- `description` — System prompt context
- `keywords` — Array of matching keywords for routing
- `toolDependencies` — Optional external tools

All agents include a `NO_FOLLOWUP_INSTRUCTION` suffix ensuring single-shot responses without conversational follow-ups.

---

## Specialized Analyzers

In addition to the 32 routed agents, DojOps provides three specialized analyzers that are invoked directly (not via `AgentRouter`):

| Analyzer       | Class               | Input                | Output Schema             | CLI Command           |
| -------------- | ------------------- | -------------------- | ------------------------- | --------------------- |
| CI Debugger    | `CIDebugger`        | CI log content       | `CIDiagnosisSchema`       | `dojops debug ci`     |
| Infra Diff     | `InfraDiffAnalyzer` | Diff content         | `InfraDiffAnalysisSchema` | `dojops analyze diff` |
| DevOps Checker | `DevOpsChecker`     | context.json + files | `CheckReportSchema`       | `dojops check`        |

### DevOps Checker

The `DevOpsChecker` (`packages/core/src/agents/devops-checker.ts`) analyzes DevOps files detected during `dojops init` for quality, security, and best practices. It produces:

- **Maturity score** (0-100) — Minimal (0-25), Basic (26-50), Good (51-75), Excellent (76-100)
- **Findings** — Severity-ranked issues (`critical`, `error`, `warning`, `info`) categorized as security, quality, best-practice, performance, or reliability
- **Missing files** — Important DevOps files the project should have but doesn't

```bash
dojops check                  # Display formatted report
dojops check --output json    # Machine-readable JSON output
```
