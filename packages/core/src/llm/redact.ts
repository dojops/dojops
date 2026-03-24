/**
 * Redacts API keys, credentials, and sensitive tokens from strings.
 * Applied to provider error messages, history entries, and audit logs.
 *
 * Pattern ordering matters: longer prefixes (sk-ant-, sk-proj-) are matched
 * before the shorter generic (sk-) to prevent partial redaction.
 */
export function redactSecrets(msg: string): string {
  return (
    msg
      // AWS access key IDs
      .replace(/AKIA[0-9A-Z]{16}/g, "AKIA***REDACTED***") // NOSONAR
      // Anthropic sk-ant- keys (before generic sk-)
      .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, "sk-ant-***REDACTED***") // NOSONAR
      // OpenAI sk-proj- keys (before generic sk-)
      .replace(/sk-proj-[A-Za-z0-9_-]{20,}/g, "sk-proj-***REDACTED***") // NOSONAR
      // Generic OpenAI sk- keys
      .replace(/sk-[A-Za-z0-9]{20,}/g, "sk-***REDACTED***") // NOSONAR
      // Claude model names in error messages
      .replace(/claude-[A-Za-z0-9_-]{20,}/g, "claude-***REDACTED***") // NOSONAR
      // Gemini AIza keys
      .replace(/AIza[A-Za-z0-9_-]{30,}/g, "AIza***REDACTED***") // NOSONAR
      // DeepSeek ds- keys
      .replace(/ds-[A-Za-z0-9]{20,}/g, "ds-***REDACTED***") // NOSONAR
      // GitHub OAuth tokens (ghu_, gho_, ghp_, ghs_, ghr_)
      .replace(/gh[uposr]_[A-Za-z0-9_]{20,}/g, "gh*_***REDACTED***") // NOSONAR
      // Private keys (PEM format)
      .replace(/-----BEGIN[A-Z ]*PRIVATE KEY-----/g, "***REDACTED_PRIVATE_KEY***") // NOSONAR
      // Password assignments in config strings
      .replace(/password\s*=\s*['"][^'"]+['"]/gi, "password=***REDACTED***") // NOSONAR
      // Secret assignments in config strings
      .replace(/secret\s*=\s*['"][^'"]+['"]/gi, "secret=***REDACTED***") // NOSONAR
      // Bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***") // NOSONAR
      // Authorization header values
      .replace(/Authorization:\s*[^\s]+/gi, "Authorization: ***REDACTED***") // NOSONAR
      // x-api-key header values (before generic api_key pattern)
      .replace(/x-api-key:\s*[^\s]+/gi, "x-api-key: ***REDACTED***") // NOSONAR
      // Generic api_key/api-key assignments
      .replace(/api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9_-]{8,}['"]?/gi, "api_key=***REDACTED***") // NOSONAR
  );
}
