/**
 * Scans content for common secret patterns before writing to disk.
 * Prevents LLM-generated output from containing hardcoded credentials.
 */

export interface SecretMatch {
  pattern: string;
  line: number;
  severity: "error" | "warning";
}

/** Placeholder values that should not trigger a blocking secret match. */
const PLACEHOLDER_PATTERNS = [
  /^changeme$/i,
  /^todo$/i,
  /^placeholder$/i,
  /^example$/i,
  /^your[_-].*[_-]here$/i,
  /^\{\{.*\}\}$/,
  /^\$\{.*\}$/,
  /^<REPLACE>$/i,
  /^<YOUR_.*>$/i,
];

function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((p) => p.test(trimmed));
}

/** Extract the quoted value from a `key = "value"` or `key = 'value'` match. */
function extractQuotedValue(line: string, pattern: RegExp): string | null {
  const match = pattern.exec(line);
  if (!match) return null;
  // The match includes the full `password = "value"` — extract value between quotes
  const valueMatch = /['"]([^'"]*)['"]\s*$/.exec(match[0]);
  return valueMatch ? valueMatch[1] : null;
}

interface SecretPattern {
  regex: RegExp;
  name: string;
  /** Severity: "error" blocks writes, "warning" is advisory. Default "error". */
  severity: "error" | "warning";
  /** If true, check extracted value against placeholder list before reporting. */
  checkPlaceholder?: boolean;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  { regex: /AKIA[0-9A-Z]{16}/, name: "AWS Access Key ID", severity: "error" },
  // GitHub tokens
  { regex: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub Personal Access Token", severity: "error" },
  { regex: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth Token", severity: "error" },
  { regex: /ghs_[a-zA-Z0-9]{36}/, name: "GitHub App Token", severity: "error" },
  { regex: /github_pat_[a-zA-Z0-9_]{22,}/, name: "GitHub Fine-Grained PAT", severity: "error" },
  // Generic API keys
  { regex: /sk-[a-zA-Z0-9]{20,}/, name: "Generic API Key (sk-)", severity: "error" },
  // Private keys
  { regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----/, name: "Private Key", severity: "error" },
  // GCP service account
  { regex: /"type"\s*:\s*"service_account"/, name: "GCP Service Account JSON", severity: "error" },
  // Azure connection strings
  {
    regex: /DefaultEndpointsProtocol=https;AccountName=/,
    name: "Azure Connection String",
    severity: "error",
  },
  // Stripe keys
  { regex: /sk_live_[a-zA-Z0-9]{24,}/, name: "Stripe Live Secret Key", severity: "error" },
  { regex: /rk_live_[a-zA-Z0-9]{24,}/, name: "Stripe Live Restricted Key", severity: "error" },
  // JWT tokens (3 base64 segments with dots)
  {
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    name: "JWT Token",
    severity: "warning",
  },
  // HashiCorp Vault
  { regex: /hvs\.[a-zA-Z0-9_-]{24,}/, name: "HashiCorp Vault Token", severity: "error" },
  // Slack tokens
  { regex: /xoxb-[0-9]{10,}-[a-zA-Z0-9]+/, name: "Slack Bot Token", severity: "error" },
  { regex: /xoxp-[0-9]{10,}-[a-zA-Z0-9]+/, name: "Slack User Token", severity: "error" },
  // Anthropic keys
  { regex: /sk-ant-[a-zA-Z0-9_-]{20,}/, name: "Anthropic API Key", severity: "error" },
  // Hardcoded credentials (check for placeholders)
  {
    regex: /password\s*=\s*['"][^'"]+['"]/,
    name: "Hardcoded password",
    severity: "warning",
    checkPlaceholder: true,
  },
  {
    regex: /secret\s*=\s*['"][^'"]+['"]/,
    name: "Hardcoded secret",
    severity: "warning",
    checkPlaceholder: true,
  },
  {
    regex: /api_key\s*=\s*['"][^'"]+['"]/,
    name: "Hardcoded API key",
    severity: "warning",
    checkPlaceholder: true,
  },
];

function matchLineAgainstPattern(
  line: string,
  lineNumber: number,
  sp: SecretPattern,
): SecretMatch | null {
  if (!sp.regex.test(line)) return null;
  // SA-13: Skip placeholder values for password/secret patterns
  if (sp.checkPlaceholder) {
    const value = extractQuotedValue(line, sp.regex);
    if (value && isPlaceholderValue(value)) return null;
  }
  return { pattern: sp.name, line: lineNumber, severity: sp.severity };
}

/**
 * Scan content for common secret patterns.
 * Returns an array of matches with the pattern name, line number, and severity.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    for (const sp of SECRET_PATTERNS) {
      const match = matchLineAgainstPattern(lines[i], i + 1, sp);
      if (match) matches.push(match);
    }
  }

  return matches;
}
