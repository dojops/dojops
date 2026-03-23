# @dojops/runtime

18 built-in DevOps tools for [DojOps](https://github.com/dojops/dojops) — AI Automation Engine.

## Built-in Tools

| Tool           | Output                                 |
| -------------- | -------------------------------------- |
| GitHub Actions | `.github/workflows/*.yml`              |
| Terraform      | `*.tf` (HCL)                           |
| Kubernetes     | `*.yaml` manifests                     |
| Helm           | `Chart.yaml`, `values.yaml`, templates |
| Ansible        | Playbooks, roles                       |
| Docker Compose | `docker-compose.yml`                   |
| Dockerfile     | `Dockerfile`                           |
| Nginx          | `nginx.conf`                           |
| Makefile       | `Makefile`                             |
| GitLab CI      | `.gitlab-ci.yml`                       |
| Prometheus     | `prometheus.yml`, alert rules          |
| Systemd        | `*.service` unit files                 |
| Jenkinsfile    | `Jenkinsfile`                          |
| Grafana        | Grafana dashboard JSON                 |
| CloudFormation | `template.yaml` (AWS CFN)              |
| ArgoCD         | ArgoCD Application manifests           |
| Pulumi         | Pulumi IaC files                       |
| OTel Collector | `otel-collector-config.yaml`           |

## Features

- Zod-validated input/output schemas per tool
- LLM-powered generation with structured output
- Auto-detection of existing configs for update workflows
- `.bak` backup before overwriting
- Optional external verification (terraform validate, hadolint, kubectl dry-run)
- `.dops` frontmatter support (scope, risk, execution semantics)

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
