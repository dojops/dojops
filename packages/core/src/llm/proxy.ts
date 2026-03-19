/**
 * HTTP(S) proxy support for LLM providers.
 *
 * Reads `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` environment variables
 * and returns proxy configuration suitable for fetch-based or SDK-based
 * providers. Enterprise networks often require proxy routing.
 */

let proxyWarned = false;

/**
 * Get the configured proxy URL from environment variables.
 * Returns undefined when no proxy is configured.
 * Priority: HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy
 */
export function getProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  );
}

/**
 * Check whether a hostname should bypass the proxy (NO_PROXY / no_proxy).
 * Supports comma-separated hostnames and wildcard prefixes (e.g. ".example.com").
 */
export function shouldBypassProxy(hostname: string): boolean {
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  if (!noProxy) return false;

  const entries = noProxy.split(",").map((e) => e.trim().toLowerCase());
  const lower = hostname.toLowerCase();

  for (const entry of entries) {
    if (entry === "*") return true;
    if (lower === entry) return true;
    if (entry.startsWith(".") && lower.endsWith(entry)) return true;
    if (lower.endsWith("." + entry)) return true;
  }

  return false;
}

/**
 * Log a one-time informational message when a proxy is detected.
 * Called by providers during initialization to confirm proxy awareness.
 */
export function logProxyStatus(providerName: string): void {
  const proxyUrl = getProxyUrl();
  if (!proxyUrl || proxyWarned) return;

  proxyWarned = true;
  console.warn(
    `[dojops] HTTP proxy detected (${proxyUrl}). ` +
      `Provider "${providerName}" will route requests through the proxy. ` +
      `Set NO_PROXY to bypass for specific hosts.`,
  );
}
