/**
 * Redacts API keys and sensitive tokens from error messages.
 * Applied to all provider error extraction to prevent key leakage.
 */
export function redactSecrets(msg: string): string {
  return (
    msg
      // Anthropic sk-ant- keys (must be before generic sk- pattern)
      .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, "sk-ant-***REDACTED***") // NOSONAR
      // OpenAI sk-proj- keys (must be before generic sk- pattern)
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
      // Bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***REDACTED***") // NOSONAR
      // Authorization header values
      .replace(/Authorization:\s*[^\s]+/gi, "Authorization: ***REDACTED***") // NOSONAR
      // x-api-key header values
      .replace(/x-api-key:\s*[^\s]+/gi, "x-api-key: ***REDACTED***") // NOSONAR
  );
}
