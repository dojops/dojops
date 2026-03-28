import { describe, it, expect, vi } from "vitest";
import dns from "node:dns/promises";
import { isPrivateIp, validateWebhookUrl } from "../../routes/auto";

vi.mock("node:dns/promises", () => ({
  default: { lookup: vi.fn() },
}));

const mockedDns = dns as unknown as { lookup: ReturnType<typeof vi.fn> };

// ── isPrivateIp ──────────────────────────────────────────────────────

describe("isPrivateIp", () => {
  it("returns true for IPv6 loopback ::1", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("returns true for IPv6 zero ::", () => {
    expect(isPrivateIp("::")).toBe(true);
  });

  it("returns true for IPv4-mapped IPv6 ::ffff:127.0.0.1", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });

  it("returns true for IPv4-mapped IPv6 ::ffff:10.0.0.1", () => {
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("returns true for 127.0.0.1 (loopback)", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("returns true for 10.x.x.x (private)", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
    expect(isPrivateIp("10.255.255.255")).toBe(true);
  });

  it("returns true for 172.16.0.0 - 172.31.255.255 (private)", () => {
    expect(isPrivateIp("172.16.0.0")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("172.20.10.5")).toBe(true);
  });

  it("returns false for 172.15.255.255 (not private)", () => {
    expect(isPrivateIp("172.15.255.255")).toBe(false);
  });

  it("returns false for 172.32.0.0 (not private)", () => {
    expect(isPrivateIp("172.32.0.0")).toBe(false);
  });

  it("returns true for 192.168.x.x (private)", () => {
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("192.168.255.255")).toBe(true);
  });

  it("returns true for 169.254.x.x (link-local)", () => {
    expect(isPrivateIp("169.254.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
  });

  it("returns true for 0.0.0.0 (zero network)", () => {
    expect(isPrivateIp("0.0.0.0")).toBe(true);
  });

  it("returns true for 100.64.x.x through 100.127.x.x (CGNAT)", () => {
    expect(isPrivateIp("100.64.0.0")).toBe(true);
    expect(isPrivateIp("100.100.100.200")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);
  });

  it("returns false for 100.63.255.255 (not CGNAT)", () => {
    expect(isPrivateIp("100.63.255.255")).toBe(false);
  });

  it("returns false for 100.128.0.0 (not CGNAT)", () => {
    expect(isPrivateIp("100.128.0.0")).toBe(false);
  });

  it("returns true for IPv6 link-local fe80::1", () => {
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("returns true for IPv6 unique local fc00::1 and fd00::1", () => {
    expect(isPrivateIp("fc00::1")).toBe(true);
    expect(isPrivateIp("fd00::1")).toBe(true);
  });

  it("returns false for public IP 8.8.8.8", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("returns false for public IP 1.1.1.1", () => {
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });

  it("returns false for non-IP string", () => {
    expect(isPrivateIp("not-an-ip")).toBe(false);
  });
});

// ── validateWebhookUrl ───────────────────────────────────────────────

describe("validateWebhookUrl", () => {
  it("throws for non-HTTP protocols", async () => {
    await expect(validateWebhookUrl("ftp://example.com")).rejects.toThrow(
      "Webhook URL must use HTTP(S)",
    );
  });

  it("throws for blocked host 169.254.169.254", async () => {
    await expect(validateWebhookUrl("http://169.254.169.254/latest")).rejects.toThrow(
      "Webhook URL targets a blocked host",
    );
  });

  it("throws for blocked host metadata.google.internal", async () => {
    await expect(
      validateWebhookUrl("http://metadata.google.internal/computeMetadata"),
    ).rejects.toThrow("Webhook URL targets a blocked host");
  });

  it("throws for blocked host localhost", async () => {
    await expect(validateWebhookUrl("http://localhost:8080/hook")).rejects.toThrow(
      "Webhook URL targets a blocked host",
    );
  });

  it("throws for blocked host 127.0.0.1", async () => {
    await expect(validateWebhookUrl("http://127.0.0.1/hook")).rejects.toThrow(
      "Webhook URL targets a blocked host",
    );
  });

  it("throws when DNS resolves to a private IP", async () => {
    mockedDns.lookup.mockResolvedValueOnce({ address: "10.0.0.5", family: 4 });

    await expect(validateWebhookUrl("https://evil.example.com/hook")).rejects.toThrow(
      "private/internal",
    );
  });

  it("does not throw when DNS resolves to a public IP", async () => {
    mockedDns.lookup.mockResolvedValueOnce({ address: "93.184.216.34", family: 4 });

    await expect(validateWebhookUrl("https://example.com/hook")).resolves.toBeUndefined();
  });

  it("throws when DNS lookup fails", async () => {
    mockedDns.lookup.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

    await expect(validateWebhookUrl("https://nonexistent.invalid/hook")).rejects.toThrow(
      "could not be resolved",
    );
  });
});
