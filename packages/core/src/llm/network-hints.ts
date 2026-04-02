/**
 * Network error diagnosis and hint generation.
 * Provides actionable messages for common network issues
 * (corporate proxies, stale connections, DNS failures).
 */

/** Known SSL error codes from OpenSSL / Node.js TLS. */
const SSL_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

/**
 * Walk the error.cause chain (max 5 levels) to find root network error details.
 */
export function extractConnectionError(
  err: unknown,
  maxDepth = 5,
): { code?: string; message: string } {
  let current: unknown = err;
  for (let i = 0; i < maxDepth && current; i++) {
    const e = current as { code?: string; message?: string; cause?: unknown };
    if (e.code && typeof e.code === "string") {
      return { code: e.code, message: e.message ?? String(current) };
    }
    current = e.cause;
  }
  return { message: String(err) };
}

/**
 * Check if an error is an SSL/TLS error by walking the cause chain.
 */
export function isSSLError(err: unknown): boolean {
  const { code, message } = extractConnectionError(err);
  if (code && SSL_ERROR_CODES.has(code)) return true;
  const msg = message.toLowerCase();
  return msg.includes("ssl") || msg.includes("certificate") || msg.includes("tls");
}

/**
 * Get a human-readable hint for SSL errors.
 * Returns undefined if the error is not SSL-related.
 */
export function getSSLErrorHint(err: unknown): string | undefined {
  if (!isSSLError(err)) return undefined;

  const { code } = extractConnectionError(err);

  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return [
      "Your network appears to use a TLS-intercepting proxy (common in corporate networks).",
      "Options:",
      "  1. Set NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem",
      "  2. Contact your IT team for the proxy CA certificate",
      "  3. As a last resort: NODE_TLS_REJECT_UNAUTHORIZED=0 (not recommended for production)",
    ].join("\n");
  }

  if (code === "CERT_HAS_EXPIRED") {
    return "The server's TLS certificate has expired. Check if your system clock is correct, or contact the API provider.";
  }

  if (code === "ERR_TLS_CERT_ALTNAME_INVALID") {
    return "The server's TLS certificate doesn't match the hostname. You may be connecting through a misconfigured proxy.";
  }

  return "A TLS/SSL error occurred. If you're behind a corporate proxy, set NODE_EXTRA_CA_CERTS to your proxy's CA certificate.";
}

/**
 * Check if an error indicates a stale/broken connection (ECONNRESET, EPIPE).
 */
export function isStaleConnectionError(err: unknown): boolean {
  const { code, message } = extractConnectionError(err);
  if (code === "ECONNRESET" || code === "EPIPE") return true;
  const msg = message.toLowerCase();
  return msg.includes("econnreset") || msg.includes("socket hang up") || msg.includes("epipe");
}

/**
 * Get a human-readable hint for connection errors.
 */
export function getConnectionErrorHint(err: unknown): string | undefined {
  const { code } = extractConnectionError(err);

  if (code === "ECONNREFUSED") {
    return "Connection refused. Check that the API server is running and the URL is correct.";
  }
  if (code === "ETIMEDOUT") {
    return "Connection timed out. Check your network connectivity and firewall settings.";
  }
  if (code === "ENOTFOUND") {
    return "DNS lookup failed. Check your internet connection and DNS settings.";
  }
  if (isStaleConnectionError(err)) {
    return "Connection was reset by the server. This is usually transient — retrying automatically.";
  }

  return undefined;
}

/**
 * Format a network error with hints for the user.
 * Returns the original message plus any applicable hint.
 */
export function formatNetworkError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const hint = getSSLErrorHint(err) ?? getConnectionErrorHint(err);
  return hint ? `${msg}\n\n${hint}` : msg;
}
