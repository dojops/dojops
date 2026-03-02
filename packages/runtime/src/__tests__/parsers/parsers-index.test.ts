import { describe, it, expect } from "vitest";
import { getParser, getAvailableParsers } from "../../parsers/index";

describe("getParser", () => {
  it("returns a parser function for known parsers", () => {
    const parser = getParser("terraform-json");
    expect(parser).toBeDefined();
    expect(typeof parser).toBe("function");
  });

  it("returns undefined for unknown parser", () => {
    const parser = getParser("nonexistent-parser");
    expect(parser).toBeUndefined();
  });

  it("returns parsers for all known types", () => {
    const knownParsers = [
      "terraform-json",
      "hadolint-json",
      "kubectl-stderr",
      "helm-lint",
      "nginx-stderr",
      "generic-stderr",
      "generic-json",
      "promtool",
      "systemd-analyze",
      "make-dryrun",
      "ansible-syntax",
      "docker-compose-config",
    ];
    for (const name of knownParsers) {
      expect(getParser(name)).toBeDefined();
    }
  });
});

describe("getAvailableParsers", () => {
  it("returns array of parser names", () => {
    const parsers = getAvailableParsers();
    expect(Array.isArray(parsers)).toBe(true);
    expect(parsers.length).toBeGreaterThan(0);
    expect(parsers).toContain("terraform-json");
    expect(parsers).toContain("nginx-stderr");
  });

  it("returns 12 parsers", () => {
    expect(getAvailableParsers()).toHaveLength(12);
  });
});
