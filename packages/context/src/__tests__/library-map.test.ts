import { describe, it, expect } from "vitest";
import { resolveLibraryQuery, TOOL_LIBRARY_MAP, AGENT_LIBRARY_MAP } from "../library-map";

describe("library-map", () => {
  describe("TOOL_LIBRARY_MAP", () => {
    it("contains all 18 built-in tool domains", () => {
      expect(Object.keys(TOOL_LIBRARY_MAP)).toHaveLength(18);
      expect(TOOL_LIBRARY_MAP["github-actions"]).toBe("github actions");
      expect(TOOL_LIBRARY_MAP["terraform"]).toBe("terraform");
      expect(TOOL_LIBRARY_MAP["kubernetes"]).toBe("kubernetes");
      expect(TOOL_LIBRARY_MAP["dockerfile"]).toBe("docker");
    });
  });

  describe("AGENT_LIBRARY_MAP", () => {
    it("maps agent domains to library queries", () => {
      expect(AGENT_LIBRARY_MAP["ci"]).toBe("github actions");
      expect(AGENT_LIBRARY_MAP["docker"]).toBe("docker");
      expect(AGENT_LIBRARY_MAP["monitoring"]).toBe("prometheus");
    });
  });

  describe("resolveLibraryQuery", () => {
    it.each([
      ["github-actions", "github actions"],
      ["terraform", "terraform"],
      ["ci", "github actions"],
      ["monitoring", "prometheus"],
      ["Terraform", "terraform"],
      ["KUBERNETES", "kubernetes"],
      ["react", "react"],
      ["unknown-tool", "unknown-tool"],
    ])("resolves %s to %s", (input, expected) => {
      expect(resolveLibraryQuery(input)).toBe(expected);
    });
  });
});
