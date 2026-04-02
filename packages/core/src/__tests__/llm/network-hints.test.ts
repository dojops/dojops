import { describe, it, expect } from "vitest";
import {
  extractConnectionError,
  isSSLError,
  getSSLErrorHint,
  isStaleConnectionError,
  getConnectionErrorHint,
  formatNetworkError,
} from "../../llm/network-hints";

// Helper: build an error with a .code property
function codedError(code: string, message: string, cause?: Error): Error & { code: string } {
  const err = new Error(message, cause ? { cause } : undefined) as Error & { code: string };
  err.code = code;
  return err;
}

// Helper: build a nested cause chain
function nestedCause(depth: number, leafCode: string, leafMessage: string): Error {
  let current: Error = codedError(leafCode, leafMessage);
  for (let i = 0; i < depth; i++) {
    current = new Error(`wrapper level ${i}`, { cause: current });
  }
  return current;
}

describe("extractConnectionError", () => {
  it("extracts code from a direct error", () => {
    const err = codedError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:443");
    const result = extractConnectionError(err);
    expect(result.code).toBe("ECONNREFUSED");
    expect(result.message).toBe("connect ECONNREFUSED 127.0.0.1:443");
  });

  it("walks nested cause chain to find code", () => {
    const inner = codedError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "certificate error");
    const middle = new Error("fetch failed", { cause: inner });
    const outer = new Error("request failed", { cause: middle });

    const result = extractConnectionError(outer);
    expect(result.code).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(result.message).toBe("certificate error");
  });

  it("respects maxDepth and returns message without code", () => {
    const deep = nestedCause(10, "ECONNRESET", "reset");
    // maxDepth 2 won't reach a 10-level deep cause
    const result = extractConnectionError(deep, 2);
    expect(result.code).toBeUndefined();
    expect(result.message).toContain("wrapper level");
  });

  it("handles non-error values", () => {
    const result = extractConnectionError("plain string error");
    expect(result.code).toBeUndefined();
    expect(result.message).toBe("plain string error");
  });

  it("handles null/undefined", () => {
    expect(extractConnectionError(null).message).toBe("null");
    expect(extractConnectionError(undefined).message).toBe("undefined");
  });
});

describe("isSSLError", () => {
  it("detects SSL error by code", () => {
    expect(isSSLError(codedError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "cert error"))).toBe(true);
    expect(isSSLError(codedError("SELF_SIGNED_CERT_IN_CHAIN", "self signed"))).toBe(true);
    expect(isSSLError(codedError("CERT_HAS_EXPIRED", "expired"))).toBe(true);
    expect(isSSLError(codedError("DEPTH_ZERO_SELF_SIGNED_CERT", "self signed"))).toBe(true);
    expect(isSSLError(codedError("ERR_TLS_CERT_ALTNAME_INVALID", "altname"))).toBe(true);
    expect(isSSLError(codedError("CERT_UNTRUSTED", "untrusted"))).toBe(true);
    expect(isSSLError(codedError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "issuer"))).toBe(true);
  });

  it("detects SSL error by message keywords", () => {
    expect(isSSLError(new Error("SSL routines: wrong version number"))).toBe(true);
    expect(isSSLError(new Error("certificate has expired"))).toBe(true);
    expect(isSSLError(new Error("TLS handshake failed"))).toBe(true);
  });

  it("detects SSL error in nested cause", () => {
    const inner = codedError("SELF_SIGNED_CERT_IN_CHAIN", "self signed cert");
    const outer = new Error("request failed", { cause: inner });
    expect(isSSLError(outer)).toBe(true);
  });

  it("returns false for non-SSL errors", () => {
    expect(isSSLError(new Error("ECONNREFUSED"))).toBe(false);
    expect(isSSLError(new Error("timeout"))).toBe(false);
    expect(isSSLError(codedError("ENOTFOUND", "dns failed"))).toBe(false);
  });
});

describe("getSSLErrorHint", () => {
  it("returns proxy hint for UNABLE_TO_VERIFY_LEAF_SIGNATURE", () => {
    const err = codedError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "cert error");
    const hint = getSSLErrorHint(err)!;
    expect(hint).toContain("TLS-intercepting proxy");
    expect(hint).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("returns proxy hint for SELF_SIGNED_CERT_IN_CHAIN", () => {
    const err = codedError("SELF_SIGNED_CERT_IN_CHAIN", "self signed");
    const hint = getSSLErrorHint(err)!;
    expect(hint).toContain("TLS-intercepting proxy");
  });

  it("returns expired cert hint for CERT_HAS_EXPIRED", () => {
    const err = codedError("CERT_HAS_EXPIRED", "expired");
    const hint = getSSLErrorHint(err)!;
    expect(hint).toContain("certificate has expired");
    expect(hint).toContain("system clock");
  });

  it("returns altname hint for ERR_TLS_CERT_ALTNAME_INVALID", () => {
    const err = codedError("ERR_TLS_CERT_ALTNAME_INVALID", "altname invalid");
    const hint = getSSLErrorHint(err)!;
    expect(hint).toContain("doesn't match the hostname");
    expect(hint).toContain("misconfigured proxy");
  });

  it("returns generic SSL hint for message-based SSL errors", () => {
    const hint = getSSLErrorHint(new Error("SSL connection failed"))!;
    expect(hint).toContain("TLS/SSL error");
    expect(hint).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("returns undefined for non-SSL errors", () => {
    expect(getSSLErrorHint(new Error("ECONNREFUSED"))).toBeUndefined();
    expect(getSSLErrorHint(new Error("timeout"))).toBeUndefined();
  });
});

describe("isStaleConnectionError", () => {
  it("detects ECONNRESET by code", () => {
    expect(isStaleConnectionError(codedError("ECONNRESET", "connection reset"))).toBe(true);
  });

  it("detects EPIPE by code", () => {
    expect(isStaleConnectionError(codedError("EPIPE", "broken pipe"))).toBe(true);
  });

  it("detects econnreset in message", () => {
    expect(isStaleConnectionError(new Error("read ECONNRESET"))).toBe(true);
  });

  it("detects socket hang up in message", () => {
    expect(isStaleConnectionError(new Error("socket hang up"))).toBe(true);
  });

  it("detects epipe in message", () => {
    expect(isStaleConnectionError(new Error("write EPIPE"))).toBe(true);
  });

  it("detects stale error in nested cause", () => {
    const inner = codedError("ECONNRESET", "reset");
    const outer = new Error("fetch failed", { cause: inner });
    expect(isStaleConnectionError(outer)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isStaleConnectionError(new Error("404 Not Found"))).toBe(false);
    expect(isStaleConnectionError(new Error("timeout"))).toBe(false);
  });
});

describe("getConnectionErrorHint", () => {
  it("returns hint for ECONNREFUSED", () => {
    const err = codedError("ECONNREFUSED", "connect ECONNREFUSED");
    const hint = getConnectionErrorHint(err)!;
    expect(hint).toContain("Connection refused");
    expect(hint).toContain("API server is running");
  });

  it("returns hint for ETIMEDOUT", () => {
    const err = codedError("ETIMEDOUT", "connect ETIMEDOUT");
    const hint = getConnectionErrorHint(err)!;
    expect(hint).toContain("timed out");
    expect(hint).toContain("firewall");
  });

  it("returns hint for ENOTFOUND", () => {
    const err = codedError("ENOTFOUND", "getaddrinfo ENOTFOUND api.openai.com");
    const hint = getConnectionErrorHint(err)!;
    expect(hint).toContain("DNS lookup failed");
  });

  it("returns hint for stale connection errors", () => {
    const err = codedError("ECONNRESET", "connection reset");
    const hint = getConnectionErrorHint(err)!;
    expect(hint).toContain("reset by the server");
    expect(hint).toContain("transient");
  });

  it("returns undefined for unknown error codes", () => {
    expect(getConnectionErrorHint(new Error("something else"))).toBeUndefined();
  });
});

describe("formatNetworkError", () => {
  it("appends SSL hint to error message", () => {
    const err = codedError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "certificate verify failed");
    const formatted = formatNetworkError(err);
    expect(formatted).toContain("certificate verify failed");
    expect(formatted).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("appends connection hint to error message", () => {
    const err = codedError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:443");
    const formatted = formatNetworkError(err);
    expect(formatted).toContain("connect ECONNREFUSED");
    expect(formatted).toContain("Connection refused");
  });

  it("returns original message when no hint applies", () => {
    const err = new Error("401 Unauthorized");
    const formatted = formatNetworkError(err);
    expect(formatted).toBe("401 Unauthorized");
  });

  it("handles non-Error values", () => {
    const formatted = formatNetworkError("raw string error");
    expect(formatted).toBe("raw string error");
  });

  it("separates message and hint with blank line", () => {
    const err = codedError("ETIMEDOUT", "connection timed out");
    const formatted = formatNetworkError(err);
    const parts = formatted.split("\n\n");
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe("connection timed out");
    expect(parts[1]).toContain("timed out");
  });
});
