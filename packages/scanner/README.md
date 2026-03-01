# @dojops/scanner

Security scanning engine for [DojOps](https://github.com/dojops/dojops) — vulnerability, dependency, IaC, and secret scanning.

## Scanners

| Scanner    | Category        | What it checks                                   |
| ---------- | --------------- | ------------------------------------------------ |
| npm-audit  | Dependencies    | Node.js dependency vulnerabilities               |
| pip-audit  | Dependencies    | Python dependency vulnerabilities                |
| trivy      | Vulnerabilities | Container image & filesystem vulnerabilities     |
| gitleaks   | Secrets         | Hardcoded secrets and credentials                |
| checkov    | IaC             | Terraform, CloudFormation, Kubernetes misconfigs |
| hadolint   | IaC             | Dockerfile best practices                        |
| shellcheck | IaC             | Shell script issues                              |
| trivy-sbom | SBOM            | CycloneDX software bill of materials             |
| semgrep    | Security        | Static analysis with custom rules                |

## Scan Modes

```bash
dojops scan --security    # Vulnerability scanning
dojops scan --deps        # Dependency audits
dojops scan --iac         # Infrastructure-as-code checks
dojops scan --sbom        # Generate SBOM
dojops scan --compare     # Compare with previous scan
```

## Output

Scan reports are saved to `.dojops/scans/` and SBOM output to `.dojops/sbom/`.

## Part of DojOps

This package is part of the [DojOps](https://github.com/dojops/dojops) monorepo. See the main repo for full documentation.

## License

MIT
