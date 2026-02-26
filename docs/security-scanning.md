# Security Scanning

DojOps's `@dojops/scanner` package provides automated security scanning with 8 scanners covering vulnerabilities, dependency audits, infrastructure-as-code checks, secret detection, shell script analysis, and SBOM generation. Findings can be automatically remediated using LLM-powered fix generation.

---

## Overview

The scanner system:

1. Discovers project directories (supports monorepos)
2. Determines which scanners are applicable based on project files
3. Runs applicable scanners in parallel
4. Aggregates findings into a structured `ScanReport`
5. Optionally generates and applies LLM-powered remediation

---

## Scanners

| Scanner     | Binary      | Categories        | Applicability                                                                     |
| ----------- | ----------- | ----------------- | --------------------------------------------------------------------------------- |
| `npm-audit` | `npm`       | `DEPENDENCY`      | Node.js projects (has `package-lock.json`)                                        |
| `pip-audit` | `pip-audit` | `DEPENDENCY`      | Python projects (has `requirements.txt`, `Pipfile`, `setup.py`, `pyproject.toml`) |
| `trivy`     | `trivy`     | `SECURITY`        | Always applicable (vulnerabilities, secrets, misconfigurations)                   |
| `gitleaks`  | `gitleaks`  | `SECRETS`         | Always applicable (hardcoded secrets and credentials)                             |
| `checkov`   | `checkov`   | `IAC`             | Projects with Terraform, Kubernetes, Helm, or Ansible files                       |
| `hadolint`  | `hadolint`  | `IAC`, `SECURITY` | Projects that have a `Dockerfile`                                                 |

---

## Scan Types

| Type       | Scanners Run         | Description                                   |
| ---------- | -------------------- | --------------------------------------------- |
| `all`      | All applicable       | Full project scan (default)                   |
| `security` | trivy, gitleaks      | Security vulnerabilities and secret detection |
| `deps`     | npm-audit, pip-audit | Dependency vulnerability audit                |
| `iac`      | checkov, hadolint    | Infrastructure-as-code linting and validation |

---

## Severity Levels

| Level      | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `CRITICAL` | Immediate action required — known exploits, exposed credentials |
| `HIGH`     | Should be fixed soon — significant vulnerabilities              |
| `MEDIUM`   | Should be addressed — moderate risk                             |
| `LOW`      | Informational — minor issues or best practice violations        |

---

## Finding Categories

| Category     | Description                         | Scanners             |
| ------------ | ----------------------------------- | -------------------- |
| `SECURITY`   | Vulnerability findings              | trivy, hadolint      |
| `DEPENDENCY` | Outdated or vulnerable dependencies | npm-audit, pip-audit |
| `IAC`        | Infrastructure-as-code issues       | checkov, hadolint    |
| `SECRETS`    | Hardcoded secrets and credentials   | gitleaks             |

---

## CLI Usage

### Full Scan

```bash
dojops scan
```

Runs all applicable scanners against the current project. Output includes:

- Scanner-by-scanner progress with spinners
- Summary table (critical/high/medium/low counts)
- Exit code 6 for HIGH findings, 7 for CRITICAL findings

### Targeted Scans

```bash
dojops scan --security       # trivy + gitleaks only
dojops scan --deps           # npm-audit + pip-audit only
dojops scan --iac            # checkov + hadolint only
```

### Auto-Remediation

```bash
dojops scan --fix            # Generate fixes, prompt for approval
dojops scan --fix --yes      # Generate and apply fixes automatically
```

The `--fix` flag:

1. Runs the scan
2. Filters findings to HIGH and CRITICAL severity
3. Sends findings to the LLM for fix generation
4. Produces a `RemediationPlan` with specific file patches
5. Prompts for approval (or auto-applies with `--yes`)
6. Applies patches to the project files

---

## API Usage

### Run a Scan

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"scanType": "all"}'
```

### Targeted Scan

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"scanType": "security", "target": "/path/to/project"}'
```

---

## Scan Report Structure

```typescript
interface ScanReport {
  id: string; // e.g. "scan-a1b2c3d4"
  projectPath: string;
  timestamp: string; // ISO 8601
  scanType: ScanType;
  findings: ScanFinding[];
  summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  scannersRun: string[];
  scannersSkipped: string[]; // format: "toolname: reason"
  durationMs: number;
}

interface ScanFinding {
  id: string;
  tool: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category: "SECURITY" | "DEPENDENCY" | "IAC" | "SECRETS";
  file?: string;
  line?: number;
  message: string;
  recommendation?: string;
  autoFixAvailable: boolean;
}
```

---

## Remediation

### How It Works

1. **Filter** — Only HIGH and CRITICAL findings are sent for remediation
2. **LLM analysis** — Findings are sent to the configured provider with a structured Zod schema
3. **Fix generation** — The LLM produces a `RemediationPlan` with specific file patches
4. **Patch application** — Fixes are applied via three action types:
   - `replace` — String replacement in a file (old>>>new format)
   - `update-version` — Version update in `package.json` or `requirements.txt`
   - `write` — Full file overwrite

### Safety

- Path-traversal protection prevents fixes from modifying files outside the project directory
- All fixes are shown for approval before application (unless `--yes` is used)
- Applied fixes are logged in the scan report

---

## Dashboard Integration

The **Security** tab in the web dashboard displays:

- Severity breakdown bar chart
- Category distribution
- Findings table with pagination and filtering
- Scan history timeline
- Top recurring issues

Data is sourced from `.dojops/scan-history/*.json` via the `MetricsAggregator`.

---

## Monorepo Support

The scanner's `discoverProjectDirs()` function searches up to 2 levels deep for sub-projects, enabling monorepo scanning. It skips common non-project directories: `node_modules`, `.git`, `.dojops`, `dist`, `build`, `coverage`, `.next`, `.cache`, `.turbo`, `__pycache__`, `.venv`, `venv`, `.tox`, `target`.
