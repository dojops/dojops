# Security Policy

## Supported Versions

| Version | Supported           |
| ------- | ------------------- |
| 1.1.x   | Yes                 |
| 1.0.x   | Security fixes only |
| < 1.0   | No                  |

## Reporting a Vulnerability

If you discover a security vulnerability in DojOps, please report it responsibly.

**Preferred:** [GitHub Security Advisories](https://github.com/dojops/dojops/security/advisories/new) (private disclosure)

**Email:** chlagoumedhedi@outlook.com

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 5 business days
- **Fix timeline:** Depends on severity, typically within 30 days for critical issues

## Disclosure Policy

- We will acknowledge your report within 48 hours
- We will work with you to understand and validate the issue
- We will release a fix and credit you (unless you prefer anonymity)
- Please do not publicly disclose the vulnerability until a fix is released

## Scope

This policy applies to:

- All packages in the `@dojops/*` npm scope (CLI, API, core, executor, etc.)
- Docker images published to `ghcr.io/dojops/dojops`
- DojOps Hub (`hub.dojops.ai`)
- DojOps documentation site (`docs.dojops.ai`)

**Out of scope:** Social engineering, denial-of-service attacks against hosted services, and issues in third-party dependencies. For dependency vulnerabilities, please report to those projects directly — but we appreciate being notified so we can update our dependencies.
