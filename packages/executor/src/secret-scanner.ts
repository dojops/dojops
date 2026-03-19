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
  /^\{\{.*\}\}$/, // {{ template }}
  /^\$\{.*\}$/, // ${VAR}
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
  { regex: /AKIA[0-9A-Z]{16}/, name: "AWS Access Key ID", severity: "error" },
  { regex: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub Personal Access Token", severity: "error" },
  { regex: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth Token", severity: "error" },
  { regex: /ghs_[a-zA-Z0-9]{36}/, name: "GitHub App Token", severity: "error" },
  { regex: /github_pat_[a-zA-Z0-9_]{22,}/, name: "GitHub Fine-Grained PAT", severity: "error" },
  { regex: /sk-[a-zA-Z0-9]{20,}/, name: "Generic API Key (sk-)", severity: "error" },
  { regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----/, name: "Private Key", severity: "error" },
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
];

/**
 * Scan content for common secret patterns.
 * Returns an array of matches with the pattern name, line number, and severity.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, name, severity, checkPlaceholder } of SECRET_PATTERNS) {
      if (regex.test(line)) {
        // SA-13: Skip placeholder values for password/secret patterns
        if (checkPlaceholder) {
          const value = extractQuotedValue(line, regex);
          if (value && isPlaceholderValue(value)) {
            continue;
          }
        }
        matches.push({ pattern: name, line: i + 1, severity });
      }
    }
  }

  return matches;
}
