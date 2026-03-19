/**
 * Scans content for common secret patterns before writing to disk.
 * Prevents LLM-generated output from containing hardcoded credentials.
 */

export interface SecretMatch {
  pattern: string;
  line: number;
}

const SECRET_PATTERNS: { regex: RegExp; name: string }[] = [
  { regex: /AKIA[0-9A-Z]{16}/, name: "AWS Access Key ID" },
  { regex: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub Personal Access Token" },
  { regex: /gho_[a-zA-Z0-9]{36}/, name: "GitHub OAuth Token" },
  { regex: /ghs_[a-zA-Z0-9]{36}/, name: "GitHub App Token" },
  { regex: /github_pat_[a-zA-Z0-9_]{22,}/, name: "GitHub Fine-Grained PAT" },
  { regex: /sk-[a-zA-Z0-9]{20,}/, name: "Generic API Key (sk-)" },
  { regex: /-----BEGIN[A-Z ]*PRIVATE KEY-----/, name: "Private Key" },
  { regex: /password\s*=\s*['"][^'"]+['"]/, name: "Hardcoded password" },
  { regex: /secret\s*=\s*['"][^'"]+['"]/, name: "Hardcoded secret" },
];

/**
 * Scan content for common secret patterns.
 * Returns an array of matches with the pattern name and line number.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, name } of SECRET_PATTERNS) {
      if (regex.test(line)) {
        matches.push({ pattern: name, line: i + 1 });
      }
    }
  }

  return matches;
}
